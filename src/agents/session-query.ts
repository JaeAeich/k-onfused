import type { ToolSpec } from '../cc/bridge.js';
import type { Embedder } from '../index/embed.js';
import type { SearchFilters, ToolIndex } from '../index/qdrant.js';
import type { Trace } from '../trace.js';
import type { RetrievalHit, ToolDef } from '../types.js';
import { AgentSession } from './session.js';

const SEARCH_TOOLS: ToolSpec = {
  name: 'search_tools',
  description:
    'Semantic search over the tool catalog. Returns candidate tools with name, description, ' +
    'app, resource, action and similarity score. Optional exact-match filters narrow the search.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language description of the capability' },
      app: {
        type: 'string',
        description: 'Exact app key, e.g. "github" or "jira_cloud" (optional)',
      },
      resource: { type: 'string', description: 'Exact resource, e.g. "issue" (optional)' },
      action: { type: 'string', description: 'Exact action, e.g. "create" (optional)' },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

const RETURN_TOOLS: ToolSpec = {
  name: 'return_tools',
  description:
    'Hand the chosen tools to the worker, most relevant first. ' +
    'Only names that appeared in a search result are accepted.',
  inputSchema: {
    type: 'object',
    properties: { tool_names: { type: 'array', items: { type: 'string' }, minItems: 0 } },
    required: ['tool_names'],
    additionalProperties: false,
  },
};

export const queryAgentSystemPrompt = (k: number, maxSearches: number) =>
  [
    'You are a tool librarian. A worker agent describes a capability it needs; ' +
      'you find the best matching tools in a large catalog.',
    `Use search_tools (up to ${maxSearches} times) with different phrasings or exact filters ` +
      '(app / resource / action) until you are confident.',
    `Then call return_tools with at most ${k} tool names, best match first. ` +
      'Return only tools you saw in results. Do not ask questions.',
  ].join('\n');

/**
 * The query agent ("librarian"): one session per request_tools call. Searches Qdrant with optional
 * payload filters and returns up to k tools. Records `search` trace events (agent = query_agent).
 */
export class QuerySession extends AgentSession {
  readonly agent = 'query_agent' as const;
  readonly systemPrompt: string;
  /** best score seen per tool_id across searches */
  private seen = new Map<string, number>();
  private searches = 0;
  returned: RetrievalHit[] | null = null;

  constructor(
    trace: Trace,
    namePrefix: string,
    private readonly deps: {
      index: ToolIndex;
      embedder: Embedder;
      toolsById: Map<string, ToolDef>;
      N: number;
      /** the trial's targets, always in the catalog */
      pinned: string[];
      k: number;
      maxSearches: number;
    },
  ) {
    super(trace, namePrefix);
    this.systemPrompt = queryAgentSystemPrompt(deps.k, deps.maxSearches);
  }

  isDone(): boolean {
    return this.returned !== null;
  }

  listTools(): ToolSpec[] {
    return [SEARCH_TOOLS, RETURN_TOOLS];
  }

  async handle(name: string, args: unknown): Promise<{ output: unknown }> {
    if (name === 'search_tools') return this.search(args as { query: string } & SearchFilters);
    return this.returnTools((args as { tool_names?: unknown }).tool_names);
  }

  private async search(a: { query: string } & SearchFilters): Promise<{ output: unknown }> {
    if (++this.searches > this.deps.maxSearches) {
      return {
        output: {
          error: 'limit_reached',
          message: 'No more searches allowed; call return_tools now.',
        },
      };
    }
    const filters: SearchFilters = {};
    for (const key of ['app', 'resource', 'action'] as const)
      if (a[key]) filters[key] = String(a[key]).toLowerCase();
    const t0 = Date.now();
    const hits = await this.deps.index.search(
      await this.deps.embedder.embedQuery(a.query),
      { N: this.deps.N, pinned: this.deps.pinned },
      this.deps.k,
      filters,
    );
    this.trace.push({
      type: 'search',
      step: this.trace.step,
      agent: 'query_agent',
      query: a.query,
      filters: Object.keys(filters).length ? filters : null,
      N: this.deps.N,
      k: this.deps.k,
      hits,
      latency_ms: Date.now() - t0,
    });
    for (const h of hits)
      this.seen.set(h.tool_id, Math.max(this.seen.get(h.tool_id) ?? 0, h.score));
    const candidates = hits.map((h) => {
      const t = this.deps.toolsById.get(h.tool_id)!;
      return {
        name: t.name,
        description: t.description,
        app: t.app,
        resource: t.resource,
        action: t.action,
        score: Number(h.score.toFixed(3)),
      };
    });
    return { output: { candidates, searches_left: this.deps.maxSearches - this.searches } };
  }

  private returnTools(names: unknown): { output: unknown } {
    const list = Array.isArray(names) ? names.map(String) : [];
    const byName = new Map([...this.deps.toolsById.values()].map((t) => [t.name, t]));
    const hits: RetrievalHit[] = [];
    for (const raw of list) {
      const t = byName.get(this.strip(raw));
      if (t && this.seen.has(t.tool_id) && !hits.some((h) => h.tool_id === t.tool_id))
        hits.push({ tool_id: t.tool_id, score: this.seen.get(t.tool_id)! });
      if (hits.length >= this.deps.k) break;
    }
    this.returned = hits;
    return { output: { ok: true, returned: hits.length } };
  }
}

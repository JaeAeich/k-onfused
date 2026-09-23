/**
 * The ways a worker's request_tools(need) turns into tool definitions:
 *   direct       embed `need`, one Qdrant search, top-k
 *   rerank       embed `need`, Qdrant top-`depth`, re-order with a local cross-encoder, top-k
 *   query_agent  a librarian LLM session runs filtered searches and picks ≤ k (see session-query.ts)
 */
import { toolEmbedText, type Embedder } from '../index/embed.js';
import type { Reranker } from '../index/rerank.js';
import type { ToolIndex } from '../index/qdrant.js';
import type { Trace } from '../trace.js';
import type { Catalog, RetrievalHit, RetrievalResult, Retriever, ToolDef } from '../types.js';
import { runSession, type RunConfig, type SessionRun } from './run-session.js';
import { QuerySession } from './session-query.js';

export interface RetrieverDeps {
  index: ToolIndex;
  embedder: Embedder;
  toolsById: Map<string, ToolDef>;
  trace: Trace;
}

const toResult = (
  deps: RetrieverDeps,
  query: string,
  hits: RetrievalHit[],
  latency_ms: number,
): RetrievalResult => ({
  query,
  hits,
  tools: hits.map((h) => {
    const t = deps.toolsById.get(h.tool_id);
    if (!t) throw new Error(`index returned unknown tool ${h.tool_id}; re-run npm run index`);
    return t;
  }),
  latency_ms,
});

/** `direct` mode: the worker's request text is embedded and sent straight to Qdrant. */
export class DirectRetriever implements Retriever {
  constructor(private readonly deps: RetrieverDeps) {}

  async retrieve(query: string, opts: Catalog & { k: number }): Promise<RetrievalResult> {
    const t0 = Date.now();
    const hits = await this.deps.index.search(
      await this.deps.embedder.embedQuery(query),
      opts,
      opts.k,
    );
    const latency_ms = Date.now() - t0;
    this.deps.trace.push({
      type: 'search',
      step: this.deps.trace.step,
      agent: 'worker',
      query,
      filters: null,
      N: opts.N,
      k: opts.k,
      hits,
      latency_ms,
    });
    return toResult(this.deps, query, hits, latency_ms);
  }
}

/** `rerank` mode: a fast one-pass "System 1" step between the vector search and the worker. */
export class RerankRetriever implements Retriever {
  constructor(
    private readonly deps: RetrieverDeps,
    private readonly reranker: Reranker,
    private readonly depth: number,
  ) {}

  async retrieve(query: string, opts: Catalog & { k: number }): Promise<RetrievalResult> {
    const t0 = Date.now();
    const candidates = await this.deps.index.search(
      await this.deps.embedder.embedQuery(query),
      opts,
      Math.max(this.depth, opts.k),
    );
    this.deps.trace.push({
      type: 'search',
      step: this.deps.trace.step,
      agent: 'worker',
      query,
      filters: null,
      N: opts.N,
      k: candidates.length,
      hits: candidates,
      latency_ms: Date.now() - t0,
    });
    const t1 = Date.now();
    const scores = await this.reranker.score(
      query,
      candidates.map((h) => toolEmbedText(this.deps.toolsById.get(h.tool_id)!)),
    );
    const rerankMs = Date.now() - t1;
    const hits = candidates
      .map((h, i) => ({ tool_id: h.tool_id, score: scores[i]! }))
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.k);
    return {
      ...toResult(this.deps, query, hits, Date.now() - t0),
      reranker: { model: this.reranker.name, candidates: candidates.length, latency_ms: rerankMs },
    };
  }
}

/** `query_agent` mode: a second LLM turns the request into one or more filtered searches and picks ≤ k tools. */
export class QueryAgentRetriever implements Retriever {
  readonly runs: SessionRun[] = [];

  constructor(
    private readonly deps: RetrieverDeps,
    private readonly run: RunConfig,
    private readonly maxSearches: number,
  ) {}

  async retrieve(query: string, opts: Catalog & { k: number }): Promise<RetrievalResult> {
    const t0 = Date.now();
    const session = new QuerySession(
      this.deps.trace,
      this.run.backend === 'claude-code' ? this.run.namePrefix : '',
      {
        ...this.deps,
        N: opts.N,
        pinned: opts.pinned,
        k: opts.k,
        maxSearches: this.maxSearches,
      },
    );
    const run = await runSession(session, `The worker needs: ${query}`, this.run);
    this.runs.push(run);
    return toResult(this.deps, query, session.returned ?? [], Date.now() - t0);
  }
}

import type { ToolSpec } from '../cc/bridge.js';
import type { MockExecutor } from '../exec/mock.js';
import type { Trace } from '../trace.js';
import type { Retriever, ToolDef } from '../types.js';
import { AgentSession } from './session.js';

export interface FinishInput {
  status: 'completed' | 'cannot_complete';
  summary: string;
}

const REQUEST_TOOLS: ToolSpec = {
  name: 'request_tools',
  description:
    'Search the tool catalog. Describe the capability you need (app, object, action). ' +
    'Returns tool definitions that you can then call directly.',
  inputSchema: {
    type: 'object',
    properties: {
      need: { type: 'string', description: 'What you need, e.g. "create an issue in GitHub"' },
    },
    required: ['need'],
    additionalProperties: false,
  },
};

const FINISH: ToolSpec = {
  name: 'finish',
  description: 'Signal that you are done with the task.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['completed', 'cannot_complete'] },
      summary: { type: 'string' },
    },
    required: ['status', 'summary'],
    additionalProperties: false,
  },
};

// one entry per line of the prompt; long lines are split only in the source, not in the text
export const WORKER_SYSTEM_PROMPT = [
  'You complete tasks by calling tools. You start with NO domain tools.',
  '1. Call request_tools with a short description of the capability you need: which app, ' +
    'which kind of object, which action. It returns tool definitions that become available to you.',
  '2. Call the tool that does the job, with arguments taken from the task. ' +
    'If a call fails validation, fix the arguments and retry.',
  '3. If the task has several parts, do them in order and search again for each part as needed.',
  '4. When every part is done, call finish with status "completed". ' +
    'If no suitable tool exists after searching, call finish with status "cannot_complete".',
  'Never invent tool names. Do not ask questions; act on the task as given.',
].join('\n');

/**
 * The worker: starts with request_tools + finish, gains domain tools as it asks for them, and executes
 * them against the mock executor. Records retrieval / tool_call / finish trace events.
 */
export class WorkerSession extends AgentSession {
  readonly agent = 'worker' as const;
  readonly systemPrompt = WORKER_SYSTEM_PROMPT;
  readonly active = new Map<string, ToolDef>();
  finish: FinishInput | null = null;
  private requests = 0;

  constructor(
    trace: Trace,
    namePrefix: string,
    private readonly deps: {
      retriever: Retriever;
      executor: MockExecutor;
      N: number;
      /** the trial's targets, always in the catalog */
      pinned: string[];
      k: number;
      maxRequestTools: number;
    },
  ) {
    super(trace, namePrefix);
  }

  isDone(): boolean {
    return this.finish !== null;
  }

  /** Meta-tools first, then domain tools in stable tool_id order (byte-identical tool block per step). */
  listTools(): ToolSpec[] {
    const domain = [...this.active.values()].sort((a, b) => a.tool_id.localeCompare(b.tool_id));
    return [
      REQUEST_TOOLS,
      FINISH,
      ...domain.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.input_schema,
      })),
    ];
  }

  async handle(name: string, args: unknown): Promise<{ output: unknown; listChanged?: boolean }> {
    if (name === 'request_tools')
      return this.requestTools(String((args as { need?: unknown })?.need ?? ''));
    if (name === 'finish') return this.doFinish(args as FinishInput);
    return this.execute(this.active.get(name)!, args);
  }

  private async requestTools(need: string): Promise<{ output: unknown; listChanged: boolean }> {
    if (++this.requests > this.deps.maxRequestTools) {
      return {
        output: {
          error: 'limit_reached',
          message:
            'No more catalog searches allowed; use the tools you already have or call finish.',
        },
        listChanged: false,
      };
    }
    const r = await this.deps.retriever.retrieve(need, {
      N: this.deps.N,
      pinned: this.deps.pinned,
      k: this.deps.k,
    });
    this.trace.push({
      type: 'retrieval',
      step: this.trace.step,
      need,
      hits: r.hits,
      latency_ms: r.latency_ms,
      ...(r.reranker ? { reranker: r.reranker } : {}),
    });
    for (const t of r.tools) this.active.set(t.name, t);
    return {
      output: {
        tools: r.tools.map((t) => ({ name: this.qualify(t.name), description: t.description })),
        note: 'These tools are now available; call them by the exact name shown.',
      },
      listChanged: r.tools.length > 0,
    };
  }

  private doFinish(input: FinishInput): { output: unknown } {
    this.finish = {
      status: input?.status === 'cannot_complete' ? 'cannot_complete' : 'completed',
      summary: String(input?.summary ?? ''),
    };
    this.trace.push({ type: 'finish', step: this.trace.step, ...this.finish });
    return { output: { ok: true } };
  }

  private execute(tool: ToolDef, args: unknown): { output: unknown } {
    const r = this.deps.executor.execute(tool, args);
    this.trace.push({
      type: 'tool_call',
      step: this.trace.step,
      tool_name: tool.name,
      tool_id: tool.tool_id,
      args,
      valid: r.valid,
      response: r.response,
    });
    return { output: r.response };
  }
}

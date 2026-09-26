import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { MCP_PREFIX, MCP_SERVER_NAME } from './bridge.js';

/** One completed assistant message, reassembled from the stream. */
export interface AssistantTurn {
  id: string;
  text: string;
  toolUses: { name: string; input: unknown }[];
  /** input incl. cache read/write tokens (reliable); output is a streaming snapshot (approximate) */
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
  latencyMs: number;
}

export interface HeadlessResult {
  model: string | null;
  subtype: string;
  isError: boolean;
  numTurns: number;
  /** Claude Code's own cost estimate; on a subscription nothing is billed */
  costUsd: number;
  usage: { inputTokens: number; outputTokens: number };
  resultText: string;
  rateLimit: RateLimitInfo | null;
  stderr: string;
}

export interface RateLimitInfo {
  status: string;
  fiveHour?: { utilization: number; resetsAt: number };
  sevenDay?: { utilization: number; resetsAt: number };
}

export interface HeadlessOptions {
  prompt: string;
  systemPrompt: string;
  model: string;
  maxTurns: number;
  timeoutMs: number;
  /** bridge URL for this session; the shim forwards all tool traffic there */
  bridgeUrl: string;
  /** called when a new assistant message starts; `turn` keeps being updated in place until onTurnEnd */
  onTurnStart?: (turn: AssistantTurn) => void;
  /** called once the message is complete (its tool calls, if any, have already been served) */
  onTurnEnd?: (turn: AssistantTurn) => void;
}

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
interface StreamEvent {
  type: string;
  subtype?: string;
  model?: string;
  is_error?: boolean;
  num_turns?: number;
  total_cost_usd?: number;
  result?: string;
  usage?: Usage;
  modelUsage?: Record<string, { canonicalModel?: string }>;
  message?: {
    id?: string;
    content?: { type: string; text?: string; name?: string; input?: unknown }[];
    usage?: Usage;
    stop_reason?: string | null;
  };
  rate_limit_info?: {
    status?: string;
    unifiedWindows?: {
      five_hour?: { utilization: number; resetsAt: number };
      seven_day?: { utilization: number; resetsAt: number };
    };
  };
}

const inputTokens = (u: Usage) =>
  (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);

const SHIM = path.resolve('src/cc/shim.ts');
const TSX = path.resolve('node_modules/tsx/dist/cli.mjs');

function buildArgs(o: HeadlessOptions): string[] {
  const mcpConfig = JSON.stringify({
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: process.execPath,
        args: [TSX, SHIM],
        env: { KONFUSED_BRIDGE: o.bridgeUrl },
      },
    },
  });
  return [
    '-p',
    o.prompt,
    '--mcp-config',
    mcpConfig,
    '--strict-mcp-config', // only our MCP server
    '--tools',
    '',
    '--allowedTools',
    `${MCP_PREFIX}*`, // no built-ins; auto-approve ours
    '--setting-sources',
    '', // ignore CLAUDE.md, hooks, user settings
    '--system-prompt',
    o.systemPrompt,
    '--model',
    o.model,
    '--max-turns',
    String(o.maxTurns),
    '--output-format',
    'stream-json',
    '--verbose',
  ];
}

/**
 * Parses Claude Code's stream-json lines into assistant turns and a final result. The stream emits one
 * `assistant` event per content block (all sharing message.id), so turns are reassembled by id: a turn
 * starts on its first block and ends when the tool results (`user` event) or the `result` arrive.
 */
export class StreamParser {
  readonly result: HeadlessResult = {
    model: null,
    subtype: 'none',
    isError: false,
    numTurns: 0,
    costUsd: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    resultText: '',
    rateLimit: null,
    stderr: '',
  };
  private current: AssistantTurn | null = null;
  private turnStart: number;

  constructor(
    private readonly hooks: {
      onTurnStart?: (t: AssistantTurn) => void;
      onTurnEnd?: (t: AssistantTurn) => void;
    },
    private readonly now: () => number = Date.now,
  ) {
    this.turnStart = now();
  }

  private flush(): void {
    if (this.current) this.hooks.onTurnEnd?.(this.current);
    this.current = null;
  }

  feed(line: string): void {
    if (!line.trim()) return;
    let e: StreamEvent;
    try {
      e = JSON.parse(line) as StreamEvent;
    } catch {
      return;
    }
    const r = this.result;
    if (e.type === 'system' && e.subtype === 'init') {
      r.model = e.model ?? null;
    } else if (e.type === 'assistant' && e.message) {
      const id = e.message.id ?? `turn-${r.numTurns}`;
      const usage = e.message.usage ?? {};
      if (!this.current || this.current.id !== id) {
        this.flush();
        this.current = {
          id,
          text: '',
          toolUses: [],
          inputTokens: 0,
          outputTokens: 0,
          stopReason: '',
          latencyMs: this.now() - this.turnStart,
        };
        this.hooks.onTurnStart?.(this.current);
      }
      const t = this.current;
      t.inputTokens = Math.max(t.inputTokens, inputTokens(usage));
      t.outputTokens = Math.max(t.outputTokens, usage.output_tokens ?? 0);
      if (e.message.stop_reason) t.stopReason = e.message.stop_reason;
      for (const b of e.message.content ?? []) {
        if (b.type === 'text' && b.text)
          t.text = [t.text, b.text.trim()].filter(Boolean).join('\n');
        if (b.type === 'tool_use' && b.name) t.toolUses.push({ name: b.name, input: b.input });
      }
    } else if (e.type === 'user') {
      // tool results arrived → the next assistant turn's latency starts now
      this.flush();
      this.turnStart = this.now();
    } else if (e.type === 'rate_limit_event' && e.rate_limit_info) {
      const w = e.rate_limit_info.unifiedWindows;
      r.rateLimit = {
        status: e.rate_limit_info.status ?? '',
        fiveHour: w?.five_hour,
        sevenDay: w?.seven_day,
      };
    } else if (e.type === 'result') {
      this.flush();
      r.subtype = e.subtype ?? 'unknown';
      r.isError = Boolean(e.is_error);
      r.numTurns = e.num_turns ?? 0;
      r.costUsd = e.total_cost_usd ?? 0;
      r.resultText = e.result ?? '';
      r.usage = {
        inputTokens: inputTokens(e.usage ?? {}),
        outputTokens: e.usage?.output_tokens ?? 0,
      };
      const mu = e.modelUsage && Object.values(e.modelUsage)[0];
      if (mu?.canonicalModel) r.model = mu.canonicalModel;
    }
  }

  /** Call once the stream is closed. */
  end(): HeadlessResult {
    this.flush();
    return this.result;
  }
}

/** Run one headless Claude Code session (`claude -p`) whose only tools come from our MCP shim. */
export async function runHeadlessClaude(o: HeadlessOptions): Promise<HeadlessResult> {
  const parser = new StreamParser({ onTurnStart: o.onTurnStart, onTurnEnd: o.onTurnEnd });
  const child = spawn('claude', buildArgs(o), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs);
  child.stderr.on('data', (d) => (parser.result.stderr += String(d)));
  for await (const line of readline.createInterface({ input: child.stdout })) parser.feed(line);
  const result = parser.end();
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  clearTimeout(timer);
  if (result.subtype === 'none') {
    throw new Error(
      `claude exited ${code} without a result: ${result.stderr.trim().slice(0, 400)}`,
    );
  }
  return result;
}

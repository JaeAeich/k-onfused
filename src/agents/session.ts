import type { BridgeHandler, ToolSpec } from '../cc/bridge.js';
import type { Trace } from '../trace.js';
import type { AgentName, TraceEvent, TraceEventBody } from '../types.js';

/** What a backend reports back after each model turn. */
export interface TurnInfo {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  stopReason: string;
  text: string;
}

/**
 * One agent's tool surface + state for one run. A session does not know which LLM backend drives it:
 * `runSession` (src/agents/run-session.ts) feeds it turns and tool calls from either headless Claude Code
 * or the AI SDK loop.
 */
export abstract class AgentSession implements BridgeHandler {
  abstract readonly agent: AgentName;
  abstract readonly systemPrompt: string;

  constructor(
    readonly trace: Trace,
    /** Claude Code shows MCP tools as mcp__ts__<name>; the AI SDK backend uses bare names */
    readonly namePrefix: string,
  ) {}

  abstract listTools(): ToolSpec[];
  abstract handle(name: string, args: unknown): Promise<{ output: unknown; listChanged?: boolean }>;
  abstract isDone(): boolean;

  /** Tool name as the model sees it. */
  qualify(name: string): string {
    return `${this.namePrefix}${name}`;
  }

  /** Bare tool name from whatever the model sent. */
  strip(name: string): string {
    return this.namePrefix && name.startsWith(this.namePrefix)
      ? name.slice(this.namePrefix.length)
      : name;
  }

  isKnown(name: string): boolean {
    const bare = this.strip(name);
    return this.listTools().some((t) => t.name === bare);
  }

  /** BridgeHandler entry point: rejects unknown names, otherwise delegates to `handle`. */
  async call(name: string, args: unknown): Promise<{ output: unknown; listChanged?: boolean }> {
    if (!this.isKnown(name)) {
      const output = { error: 'unknown_tool', message: `No tool named ${name} is available.` };
      this.trace.push({
        type: 'tool_call',
        step: this.trace.step,
        tool_name: name,
        tool_id: null,
        args,
        valid: false,
        response: output,
      });
      return { output };
    }
    return this.handle(this.strip(name), args);
  }

  /** Push an llm_call event; returns it so the caller can fill in fields that arrive later. */
  recordTurn(t: TurnInfo): Extract<TraceEvent, { type: 'llm_call' }> {
    const ev: Extract<TraceEventBody, { type: 'llm_call' }> = {
      type: 'llm_call',
      step: this.trace.step,
      agent: this.agent,
      model: t.model,
      input_tokens: t.inputTokens,
      output_tokens: t.outputTokens,
      latency_ms: t.latencyMs,
      finish_reason: t.stopReason,
      text: t.text,
      n_tools: this.listTools().length,
    };
    return this.trace.push(ev) as Extract<TraceEvent, { type: 'llm_call' }>;
  }
}

import { jsonSchema, tool, type ModelMessage, type ToolResultPart, type ToolSet } from 'ai';
import { randomUUID } from 'node:crypto';
import { MCP_PREFIX, type Bridge } from '../cc/bridge.js';
import { runHeadlessClaude, type HeadlessResult } from '../cc/headless.js';
import type { Backend, RateLimitState } from '../types.js';
import { Llm } from './llm.js';
import type { AgentSession } from './session.js';

export interface RunConfig {
  backend: Backend;
  model: string;
  stepCap: number;
  timeoutMs: number;
  /** required for backend=claude-code */
  bridge?: Bridge;
  /** prefix sessions must use for this backend (MCP_PREFIX for claude-code, '' otherwise) */
  namePrefix: string;
}

export interface SessionRun {
  status: 'done' | 'ended' | 'step_limit' | 'error';
  error?: string;
  rateLimit?: RateLimitState | null;
  usage: { inputTokens: number; outputTokens: number };
  llmCalls: number;
  costUsd: number;
  cc?: HeadlessResult;
}

export const runConfigFor = (
  backend: Backend,
  model: string,
  stepCap: number,
  timeoutMs: number,
  bridge?: Bridge,
): RunConfig => ({
  backend,
  model,
  stepCap,
  timeoutMs,
  bridge,
  namePrefix: backend === 'claude-code' ? MCP_PREFIX : '',
});

/** Drive one agent session to completion on the configured backend. */
export function runSession(
  session: AgentSession,
  prompt: string,
  cfg: RunConfig,
): Promise<SessionRun> {
  return cfg.backend === 'claude-code'
    ? runOnClaudeCode(session, prompt, cfg)
    : runOnAiSdk(session, prompt, cfg);
}

/** Headless Claude Code owns the loop; we observe turns and serve tool calls through the bridge. */
async function runOnClaudeCode(
  session: AgentSession,
  prompt: string,
  cfg: RunConfig,
): Promise<SessionRun> {
  if (!cfg.bridge) throw new Error('claude-code backend needs a Bridge');
  const id = randomUUID();
  cfg.bridge.register(id, session);
  let llmCalls = 0;
  const events = new Map<string, ReturnType<AgentSession['recordTurn']>>();
  try {
    const cc = await runHeadlessClaude({
      prompt,
      systemPrompt:
        `${session.systemPrompt}\n` +
        `All tools are named with the prefix "${MCP_PREFIX}"; call them by that exact name.`,
      model: cfg.model,
      maxTurns: cfg.stepCap,
      timeoutMs: cfg.timeoutMs,
      bridgeUrl: cfg.bridge.url(id),
      // record the turn as soon as it starts so the tool events it triggers land after it, then
      // back-fill usage/text once the message is complete
      onTurnStart: (turn) => {
        llmCalls++;
        session.trace.step++;
        events.set(
          turn.id,
          session.recordTurn({
            model: cfg.model,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: turn.latencyMs,
            stopReason: '',
            text: '',
          }),
        );
      },
      onTurnEnd: (turn) => {
        const ev = events.get(turn.id);
        if (ev)
          Object.assign(ev, {
            input_tokens: turn.inputTokens,
            output_tokens: turn.outputTokens,
            finish_reason: turn.stopReason,
            text: turn.text,
          });
        // Claude Code rejects unknown tool names itself, so they never reach the shim; record them here
        for (const tu of turn.toolUses)
          if (!session.isKnown(tu.name)) void session.call(tu.name, tu.input);
      },
    });
    // the resolved model id is only known at the end; back-fill this session's turns
    if (cc.model)
      for (const e of session.trace.events)
        if (e.type === 'llm_call' && e.agent === session.agent && e.model === cfg.model)
          e.model = cc.model;
    const status: SessionRun['status'] = session.isDone()
      ? 'done'
      : cc.subtype === 'error_max_turns'
        ? 'step_limit'
        : cc.isError
          ? 'error'
          : 'ended';
    return {
      status,
      error:
        status === 'error' ? `claude ${cc.subtype}: ${cc.resultText.slice(0, 300)}` : undefined,
      usage: cc.usage,
      llmCalls,
      costUsd: cc.costUsd,
      cc,
      rateLimit: cc.rateLimit && {
        status: cc.rateLimit.status,
        five_hour: cc.rateLimit.fiveHour && {
          utilization: cc.rateLimit.fiveHour.utilization,
          resets_at: cc.rateLimit.fiveHour.resetsAt,
        },
        seven_day: cc.rateLimit.sevenDay && {
          utilization: cc.rateLimit.sevenDay.utilization,
          resets_at: cc.rateLimit.sevenDay.resetsAt,
        },
      },
    };
  } finally {
    cfg.bridge.unregister(id);
  }
}

/** We own the loop: one AI SDK call per step; tools have no `execute` so every call comes back to us. */
async function runOnAiSdk(
  session: AgentSession,
  prompt: string,
  cfg: RunConfig,
): Promise<SessionRun> {
  const llm = new Llm(cfg.model);
  const messages: ModelMessage[] = [{ role: 'user', content: prompt }];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let costUsd = 0;
  for (let step = 1; step <= cfg.stepCap; step++) {
    session.trace.step++;
    const tools: ToolSet = {};
    for (const t of session.listTools())
      tools[t.name] = tool({ description: t.description, inputSchema: jsonSchema(t.inputSchema) });

    const res = await llm.call({ instructions: session.systemPrompt, messages, tools });
    usage.inputTokens += res.usage.input;
    usage.outputTokens += res.usage.output;
    costUsd += res.cost_usd;
    session.recordTurn({
      model: llm.modelId,
      inputTokens: res.usage.input,
      outputTokens: res.usage.output,
      latencyMs: res.latency_ms,
      stopReason: res.finishReason,
      text: res.text,
    });
    messages.push(...res.responseMessages);
    if (res.toolCalls.length === 0) return { status: 'ended', usage, llmCalls: step, costUsd };

    const results: ToolResultPart[] = [];
    for (const call of res.toolCalls) {
      const { output } = await session.call(call.toolName, call.input);
      results.push({
        type: 'tool-result',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { type: 'json', value: output as never },
      });
    }
    messages.push({ role: 'tool', content: results });
    if (session.isDone()) return { status: 'done', usage, llmCalls: step, costUsd };
  }
  return { status: 'step_limit', usage, llmCalls: cfg.stepCap, costUsd };
}

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, isStepCount, type ModelMessage, type ToolSet } from 'ai';
import { config } from '../config.js';

export interface LlmToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
  invalid: boolean;
}
export interface LlmResult {
  text: string;
  toolCalls: LlmToolCall[];
  responseMessages: ModelMessage[];
  usage: { input: number; output: number };
  cost_usd: number;
  latency_ms: number;
  finishReason: string;
}

/** Thin wrapper: one model call, no tool execution. OTel instrumentation hooks in here later. */
export class Llm {
  private provider;
  constructor(readonly modelId: string) {
    if (!config.openrouterKey)
      throw new Error('OPENROUTER_API_KEY is not set (copy .env.example to .env)');
    this.provider = createOpenRouter({ apiKey: config.openrouterKey });
  }

  async call(p: {
    instructions: string;
    messages: ModelMessage[];
    tools: ToolSet;
  }): Promise<LlmResult> {
    const t0 = Date.now();
    const res = await generateText({
      model: this.provider.chat(this.modelId),
      instructions: p.instructions,
      messages: p.messages,
      tools: p.tools,
      stopWhen: isStepCount(1),
      providerOptions: { openrouter: { usage: { include: true } } },
    });
    const or = res.providerMetadata?.openrouter as { usage?: { cost?: number } } | undefined;
    return {
      text: res.text,
      toolCalls: res.toolCalls.map((c) => ({
        toolCallId: c.toolCallId,
        toolName: c.toolName,
        input: c.input,
        invalid: Boolean((c as { invalid?: boolean }).invalid),
      })),
      responseMessages: res.response.messages,
      usage: { input: res.usage.inputTokens ?? 0, output: res.usage.outputTokens ?? 0 },
      cost_usd: or?.usage?.cost ?? 0,
      latency_ms: Date.now() - t0,
      finishReason: res.finishReason,
    };
  }
}

/**
 * OpenTelemetry export. Spans are rebuilt from a finished TrialRecord's events (every event has a
 * timestamp), so the agents stay free of tracing code and old results can be re-exported.
 *
 * Attribute naming: gen_ai.* where the GenAI semantic conventions have a name, eval.* for ours, plus
 * openinference.span.kind / input.value / output.value so Arize Phoenix renders the tree natively.
 */
import { context, trace, type Attributes, type Span, type Tracer } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { config } from './config.js';
import type { TraceEvent, TrialRecord } from './types.js';
import { targetsOf, taskKind } from './report/stats.js';

// ---------------------------------------------------------------------------
// Pure part: TrialRecord → span tree (unit-tested)
// ---------------------------------------------------------------------------
export type SpanKind = 'CHAIN' | 'AGENT' | 'LLM' | 'RETRIEVER' | 'TOOL';
export interface SpanNode {
  name: string;
  kind: SpanKind;
  start: number;
  end: number;
  attributes: Attributes;
  children: SpanNode[];
}

type Ev<T extends TraceEvent['type']> = Extract<TraceEvent, { type: T }>;
const json = (v: unknown) => JSON.stringify(v) ?? '';

function llmSpan(e: Ev<'llm_call'>, ts: number): SpanNode {
  return {
    name: `${e.agent} turn ${e.step}`,
    kind: 'LLM',
    start: ts - e.latency_ms,
    end: ts,
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': e.model,
      'gen_ai.usage.input_tokens': e.input_tokens,
      'gen_ai.usage.output_tokens': e.output_tokens,
      'gen_ai.response.finish_reasons': [e.finish_reason],
      'llm.model_name': e.model,
      'llm.token_count.prompt': e.input_tokens,
      'llm.token_count.completion': e.output_tokens,
      'eval.agent': e.agent,
      'eval.step': e.step,
      'eval.n_tools': e.n_tools,
      'output.value': e.text,
    },
    children: [],
  };
}

function searchSpan(e: Ev<'search'>, ts: number, targets: string[]): SpanNode {
  return {
    name: e.agent === 'query_agent' ? 'search_tools' : 'vector search',
    kind: 'RETRIEVER',
    start: ts - e.latency_ms,
    end: ts,
    attributes: {
      'input.value': e.query,
      'eval.filters': json(e.filters),
      'eval.N': e.N,
      'eval.k': e.k,
      'eval.hit_tool_ids': e.hits.map((h) => h.tool_id),
      'eval.hit_scores': e.hits.map((h) => h.score),
      'eval.target_hit': e.hits.some((h) => targets.includes(h.tool_id)),
      'eval.target_rank': e.hits.findIndex((h) => targets.includes(h.tool_id)) + 1, // 0 = not in this search
    },
    children: [],
  };
}

function toolSpan(e: Ev<'tool_call'>, ts: number, targets: string[]): SpanNode {
  return {
    name: e.tool_name,
    kind: 'TOOL',
    start: ts,
    end: ts + 1,
    attributes: {
      'gen_ai.tool.name': e.tool_name,
      'gen_ai.tool.call.arguments': json(e.args),
      'input.value': json(e.args),
      'output.value': json(e.response),
      'eval.tool_id': e.tool_id ?? 'unknown',
      'eval.valid_args': e.valid,
      'eval.is_target': e.tool_id !== null && targets.includes(e.tool_id),
      'eval.hallucinated': e.tool_id === null,
    },
    children: [],
  };
}

/**
 * Tree shape:
 *   trial
 *   ├─ worker turn 1 (LLM)
 *   │   └─ request_tools (CHAIN) ← vector search | query_agent turns + search_tools
 *   ├─ worker turn 2 (LLM)
 *   │   └─ <tool> (TOOL)
 *   └─ grade
 */
export function spanTreeFromRecord(r: TrialRecord): SpanNode {
  const t0 = Date.parse(r.started_at);
  const targets = targetsOf(r);
  const ts = (e: TraceEvent) => e.ts ?? t0;
  const root: SpanNode = {
    name: `trial ${r.task_id} N=${r.N} k=${r.k} ${r.mode}`,
    kind: 'CHAIN',
    start: t0,
    end: t0 + r.latency_ms,
    attributes: {
      'openinference.project.name': 'k-onfused',
      'input.value': r.task.prompt,
      'output.value': r.metrics.success ? 'PASS' : `FAIL ${r.failure_type}`,
      'eval.trial_key': r.trial_key,
      'eval.run_id': r.run_id,
      'eval.task_id': r.task_id,
      'eval.target_tool': (r.task.target_names ?? [r.task.target_name]).join(' + '),
      'eval.task_kind': taskKind(r),
      'eval.N': r.N,
      'eval.k': r.k,
      'eval.mode': r.mode,
      'eval.backend': r.backend,
      'gen_ai.request.model': r.model,
      'eval.qa_model': r.qa_model ?? '',
      'eval.success': r.metrics.success,
      'eval.failure_type': r.failure_type ?? 'none',
      'eval.search_hit': r.metrics.search_hit,
      'eval.retrieval_hit': r.metrics.retrieval_hit,
      'eval.selection_correct': r.metrics.selection_correct,
      'eval.args_correct': r.metrics.args_correct,
      'eval.steps': r.metrics.steps,
      'gen_ai.usage.input_tokens': r.usage.input_tokens,
      'gen_ai.usage.output_tokens': r.usage.output_tokens,
      'eval.llm_calls': r.usage.llm_calls + r.usage.query_agent_llm_calls,
      'eval.cost_usd': r.cost_usd,
      ...(r.error ? { 'eval.error': r.error } : {}),
    },
    children: [],
  };

  let turn: SpanNode | null = null; // current worker turn
  let pending: SpanNode[] = []; // query-agent activity waiting for its request_tools parent
  for (const e of r.events) {
    const at = ts(e);
    switch (e.type) {
      case 'llm_call':
        if (e.agent === 'worker') {
          turn = llmSpan(e, at);
          root.children.push(turn);
        } else pending.push(llmSpan(e, at));
        break;
      case 'search':
        (e.agent === 'worker' ? (turn?.children ?? root.children) : pending).push(
          searchSpan(e, at, targets),
        );
        break;
      case 'retrieval': {
        const start = pending[0]?.start ?? at - e.latency_ms;
        const node: SpanNode = {
          name: 'request_tools',
          kind: 'CHAIN',
          start,
          end: at,
          attributes: {
            'input.value': e.need,
            'output.value': json(e.hits.map((h) => h.tool_id)),
            'eval.delivered': e.hits.length,
            'eval.target_delivered': e.hits.some((h) => targets.includes(h.tool_id)),
          },
          children: pending,
        };
        pending = [];
        (turn?.children ?? root.children).push(node);
        break;
      }
      case 'tool_call':
        (turn?.children ?? root.children).push(toolSpan(e, at, targets));
        break;
      case 'finish':
        (turn?.children ?? root.children).push({
          name: 'finish',
          kind: 'TOOL',
          start: at,
          end: at + 1,
          attributes: { 'input.value': e.status, 'output.value': e.summary },
          children: [],
        });
        break;
      case 'note':
        (turn?.children ?? root.children).push({
          name: 'note',
          kind: 'CHAIN',
          start: at,
          end: at + 1,
          attributes: { 'output.value': e.text },
          children: [],
        });
        break;
    }
  }
  root.children.push({
    name: 'grade',
    kind: 'CHAIN',
    start: root.end - 1,
    end: root.end,
    attributes: { 'output.value': json(r.metrics), 'eval.failure_type': r.failure_type ?? 'none' },
    children: [],
  });
  return root;
}

// ---------------------------------------------------------------------------
// Exporter (no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set)
// ---------------------------------------------------------------------------
let provider: BasicTracerProvider | null = null;
let tracer: Tracer | null = null;

export function telemetryEnabled(): boolean {
  return Boolean(config.otlpEndpoint);
}

function getTracer(): Tracer | null {
  if (!config.otlpEndpoint) return null;
  if (!tracer) {
    provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        'service.name': 'k-onfused',
        'openinference.project.name': 'k-onfused',
      }),
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: config.otlpEndpoint }))],
    });
    tracer = provider.getTracer('k-onfused');
  }
  return tracer;
}

function emit(t: Tracer, node: SpanNode, parent?: Span): void {
  const ctx = parent ? trace.setSpan(context.active(), parent) : context.active();
  const span = t.startSpan(
    node.name,
    {
      startTime: node.start,
      attributes: { 'openinference.span.kind': node.kind, ...node.attributes },
    },
    ctx,
  );
  for (const child of node.children) emit(t, child, span);
  span.end(Math.max(node.end, node.start + 1));
}

/** Export one trial as a span tree. Returns false when telemetry is off. */
export function exportTrial(record: TrialRecord): boolean {
  const t = getTracer();
  if (!t) return false;
  emit(t, spanTreeFromRecord(record));
  return true;
}

/** Flush pending spans; prints a warning instead of throwing when the collector is unreachable. */
export async function flushTelemetry(): Promise<void> {
  if (!provider) return;
  try {
    await provider.forceFlush();
    await provider.shutdown();
  } catch (e) {
    console.warn(
      `telemetry: export to ${config.otlpEndpoint} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  provider = null;
  tracer = null;
}

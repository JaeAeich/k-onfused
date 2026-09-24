import type { ToolDef, TraceEvent, TrialRecord } from '../types.js';

const short = (v: unknown, n = 160) => {
  const s = JSON.stringify(v) ?? '';
  return s.length > n ? s.slice(0, n) + '…' : s;
};
const flag = (b: boolean) => (b ? '✓' : '✗');

/** Live, human-readable rendering of one trace event. */
export function eventLine(
  e: TraceEvent,
  ctx: { byId: Map<string, ToolDef>; targetIds: string[] },
): string {
  const isTarget = (id: string) => ctx.targetIds.includes(id);
  const mark = (id: string) => (isTarget(id) ? '   ◀ target' : '');
  const name = (id: string) => ctx.byId.get(id)?.name ?? id;
  switch (e.type) {
    case 'llm_call': {
      const who = e.agent === 'query_agent' ? 'query-agent' : 'worker';
      const text = e.text ? `  text="${e.text.slice(0, 80).replace(/\n/g, ' ')}"` : '';
      // on the Claude Code backend token counts are back-filled after the turn's tool calls complete
      const tokens = e.input_tokens
        ? `in=${e.input_tokens} out≈${e.output_tokens}`
        : 'tokens pending';
      return `\nstep ${e.step}  ${who} llm ${(e.latency_ms / 1000).toFixed(1)}s  ${tokens}  tools=${e.n_tools}${text}`;
    }
    case 'search': {
      const who = e.agent === 'query_agent' ? 'search_tools' : 'search';
      const f = e.filters ? ` ${JSON.stringify(e.filters)}` : '';
      const rows = e.hits.map(
        (h, i) =>
          `      ${String(i + 1).padStart(2)}  ${h.score.toFixed(3)}  ${name(h.tool_id)}${mark(h.tool_id)}`,
      );
      if (!e.hits.some((h) => isTarget(h.tool_id))) rows.push('      (no target in this search)');
      return [`  → ${who}("${e.query}"${f})  ${e.latency_ms}ms`, ...rows].join('\n');
    }
    case 'retrieval': {
      const got = e.hits.map((h) => name(h.tool_id) + (isTarget(h.tool_id) ? ' ◀' : '')).join(', ');
      return `  ⇒ request_tools("${e.need}") delivered ${e.hits.length}: ${got || '(nothing)'}`;
    }
    case 'tool_call': {
      const status = e.tool_id === null ? '✗ UNKNOWN TOOL' : e.valid ? '✓ valid' : '✗ invalid';
      return (
        `  → ${e.tool_name}(${short(e.args)})  ${status}${mark(e.tool_id ?? '')}` +
        `\n      ${short(e.response, 120)}`
      );
    }
    case 'finish':
      return `  → finish(${e.status}, "${e.summary.slice(0, 100)}")`;
    case 'note':
      return `  note: ${e.text}`;
  }
}

export function summaryLines(r: TrialRecord): string[] {
  const m = r.metrics;
  const parts = m.parts_total && m.parts_total > 1 ? `parts=${m.parts_done}/${m.parts_total} ` : '';
  const qaCalls = r.usage.query_agent_llm_calls
    ? `+${r.usage.query_agent_llm_calls} (query agent)`
    : '';
  const qa = r.qa_model ? ` qa_model=${r.qa_model}` : '';
  const err = r.error ? `\nerror: ${r.error}` : '';
  return [
    `RESULT: ${m.success ? 'PASS' : `FAIL (${r.failure_type})`}   ` +
      `search_hit=${flag(m.search_hit)} retrieval_hit=${flag(m.retrieval_hit)} ` +
      `selection=${flag(m.selection_correct)} args=${flag(m.args_correct)} ` +
      `${parts}extra_calls=${m.extra_calls} ` +
      `hallucinated=${m.hallucinated_calls} steps=${m.steps}`,
    `tokens in=${r.usage.input_tokens} out=${r.usage.output_tokens} ` +
      `llm_calls=${r.usage.llm_calls}${qaCalls}` +
      `  est_cost=$${r.cost_usd.toFixed(4)}  ${(r.latency_ms / 1000).toFixed(1)}s` +
      `  model=${r.model}${qa}${err}`,
  ];
}

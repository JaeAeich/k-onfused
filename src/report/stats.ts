/**
 * Pure aggregation over trial records. Browser-safe: no Node imports. This file is unit-tested in Node
 * and also transpiled + inlined into report.html, so the page computes the same numbers.
 */
import type { FailureType, TaskKind, TrialRecord } from '../types.js';

export const FAILURE_TYPES: FailureType[] = [
  'retrieval_miss',
  'wrong_tool',
  'bad_args',
  'hallucinated_tool',
  'gave_up',
  'step_limit',
];

/** Wilson score interval for a binomial proportion (95%). */
export function wilson(
  successes: number,
  n: number,
  z = 1.96,
): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: NaN, lo: NaN, hi: NaN };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export interface Rate {
  p: number;
  lo: number;
  hi: number;
  n: number;
}

/** One cell of the sweep: everything with the same (mode, backend, model, N, k). */
export interface Cell {
  mode: string;
  backend: string;
  model: string;
  N: number;
  k: number;
  n: number;
  success: Rate;
  search_hit: Rate;
  retrieval_hit: Rate;
  /** P(target called | target delivered) */
  selection_given_hit: Rate;
  /** P(args right | target called) */
  args_given_selection: Rate;
  failures: Record<FailureType, number>;
  mean_input_tokens: number;
  mean_output_tokens: number;
  mean_latency_ms: number;
  mean_llm_calls: number;
}

const rate = (rows: TrialRecord[], pred: (r: TrialRecord) => boolean): Rate => {
  const w = wilson(rows.filter(pred).length, rows.length);
  return { ...w, n: rows.length };
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export const cellKey = (r: Pick<TrialRecord, 'mode' | 'backend' | 'model' | 'N' | 'k'>) =>
  `${r.mode}|${r.backend}|${r.model}|${r.N}|${r.k}`;

export function aggregate(records: TrialRecord[]): Cell[] {
  const groups = new Map<string, TrialRecord[]>();
  for (const r of records) {
    const key = cellKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const cells: Cell[] = [];
  for (const rows of groups.values()) {
    const first = rows[0]!;
    const hit = rows.filter((r) => r.metrics.retrieval_hit);
    const sel = rows.filter((r) => r.metrics.selection_correct);
    const failures = Object.fromEntries(FAILURE_TYPES.map((f) => [f, 0])) as Record<
      FailureType,
      number
    >;
    for (const r of rows) if (r.failure_type) failures[r.failure_type]++;
    cells.push({
      mode: first.mode,
      backend: first.backend,
      model: first.model,
      N: first.N,
      k: first.k,
      n: rows.length,
      success: rate(rows, (r) => r.metrics.success),
      search_hit: rate(rows, (r) => r.metrics.search_hit),
      retrieval_hit: rate(rows, (r) => r.metrics.retrieval_hit),
      selection_given_hit: rate(hit, (r) => r.metrics.selection_correct),
      args_given_selection: rate(sel, (r) => r.metrics.args_correct),
      failures,
      mean_input_tokens: mean(rows.map((r) => r.usage.input_tokens)),
      mean_output_tokens: mean(rows.map((r) => r.usage.output_tokens)),
      mean_latency_ms: mean(rows.map((r) => r.latency_ms)),
      mean_llm_calls: mean(rows.map((r) => r.usage.llm_calls + r.usage.query_agent_llm_calls)),
    });
  }
  return cells.sort(
    (a, b) =>
      a.mode.localeCompare(b.mode) || a.model.localeCompare(b.model) || a.N - b.N || a.k - b.k,
  );
}

export const uniqueSorted = <T>(xs: T[]): T[] =>
  [...new Set(xs)].sort((a, b) =>
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)),
  );

/** All target tool ids of a record (older records only have the single target). */
export const targetsOf = (r: TrialRecord): string[] =>
  r.task.target_tool_ids ?? [r.task.target_tool_id];

export const taskKind = (r: Pick<TrialRecord, 'task'>): TaskKind =>
  !r.task.tags.multi_step ? 'single' : r.task.tags.cross_app ? 'cross_app' : 'chain';

export const CONFUSER_BUCKETS = ['0', '1–5', '6–20', '21–100', '>100'];
export const confuserBucket = (n: number): string =>
  n === 0 ? '0' : n <= 5 ? '1–5' : n <= 20 ? '6–20' : n <= 100 ? '21–100' : '>100';

export interface BreakdownRow {
  key: string;
  n: number;
  success: Rate;
  retrieval_hit: Rate;
  selection_given_hit: Rate;
  /** mean fraction of parts done (partial credit on multi-step tasks) */
  parts: number;
}

/** Success etc. per group; `order` fixes row order, groups missing from it go last. */
export function breakdown(
  records: TrialRecord[],
  keyOf: (r: TrialRecord) => string | null,
  order: string[] = [],
): BreakdownRow[] {
  const groups = new Map<string, TrialRecord[]>();
  for (const r of records) {
    const key = keyOf(r);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const pos = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return [...groups.entries()]
    .sort(([a], [b]) => pos(a) - pos(b) || a.localeCompare(b))
    .map(([key, rows]) => ({
      key,
      n: rows.length,
      success: rate(rows, (r) => r.metrics.success),
      retrieval_hit: rate(rows, (r) => r.metrics.retrieval_hit),
      selection_given_hit: rate(
        rows.filter((r) => r.metrics.retrieval_hit),
        (r) => r.metrics.selection_correct,
      ),
      parts: mean(
        rows.map((r) =>
          r.metrics.parts_total
            ? r.metrics.parts_done! / r.metrics.parts_total
            : r.metrics.success
              ? 1
              : 0,
        ),
      ),
    }));
}

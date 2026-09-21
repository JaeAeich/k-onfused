import type { ArgConstraint, FailureType, Task, TraceEvent, TrialMetrics } from './types.js';

const getPath = (obj: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (o, key) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined),
      obj,
    );

const norm = (v: unknown) =>
  String(v)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^["'“”]+|["'“”]+$/g, '');

/** `refs[i]` = ids returned by valid calls to expected_calls[i], for `{ ref: i }` constraints. */
export function satisfies(actual: unknown, c: ArgConstraint, refs: Set<string>[] = []): boolean {
  if ('eq' in c)
    return typeof c.eq === 'number'
      ? Number(actual) === c.eq
      : JSON.stringify(actual) === JSON.stringify(c.eq);
  if ('ieq' in c) return typeof actual === 'string' && norm(actual) === norm(c.ieq);
  if ('includes' in c)
    return (
      Array.isArray(actual) && c.includes.every((x) => actual.some((a) => norm(a) === norm(x)))
    );
  if ('ref' in c) return actual !== undefined && !!refs[c.ref]?.has(String(actual));
  return false;
}

export function argsMatch(
  args: unknown,
  expected: Record<string, ArgConstraint>,
  refs: Set<string>[] = [],
): boolean {
  return Object.entries(expected).every(([path, c]) => satisfies(getPath(args, path), c, refs));
}

/**
 * Score one trial from its trace. Every expected call (step) must be satisfied by some valid call to its
 * tool; search_hit / retrieval_hit / selection_correct likewise hold only if they hold for every step.
 *
 * failure_type (only when not successful) describes the first unsatisfied step; first match wins:
 *   hallucinated_tool (any) → retrieval_miss → bad_args (its tool called, args wrong) → wrong_tool (other
 *   tools called) → step_limit → gave_up
 */
export function grade(
  task: Task,
  events: TraceEvent[],
  hitStepLimit: boolean,
): { metrics: TrialMetrics; failure_type: FailureType | null } {
  const searched = new Set(
    events.flatMap((e) => (e.type === 'search' ? e.hits.map((h) => h.tool_id) : [])),
  );
  const retrieved = new Set(
    events.flatMap((e) => (e.type === 'retrieval' ? e.hits.map((h) => h.tool_id) : [])),
  );
  const calls = events.filter(
    (e): e is Extract<TraceEvent, { type: 'tool_call' }> => e.type === 'tool_call',
  );
  const targets = new Set(task.expected_calls.map((x) => x.tool_id));
  const hallucinated = calls.filter((c) => c.tool_id === null);
  const otherCalls = calls.filter((c) => c.tool_id !== null && !targets.has(c.tool_id));

  const responseId = (r: unknown) =>
    r && typeof r === 'object' && 'id' in r ? String((r as { id: unknown }).id) : null;
  const refs = task.expected_calls.map(
    (x) =>
      new Set(
        calls
          .filter((c) => c.tool_id === x.tool_id && c.valid)
          .map((c) => responseId(c.response))
          .filter((id): id is string => id !== null),
      ),
  );
  const steps = task.expected_calls.map((x) => {
    const own = calls.filter((c) => c.tool_id === x.tool_id);
    return {
      searched: searched.has(x.tool_id),
      retrieved: retrieved.has(x.tool_id),
      called: own.length > 0,
      done: own.some((c) => c.valid && argsMatch(c.args, x.args, refs)),
    };
  });

  const selection_correct = steps.every((s) => s.called);
  const args_correct = steps.every((s) => s.done);
  const success = selection_correct && args_correct;
  const metrics: TrialMetrics = {
    search_hit: steps.every((s) => s.searched),
    retrieval_hit: steps.every((s) => s.retrieved),
    selection_correct,
    args_correct,
    success,
    extra_calls: otherCalls.length,
    hallucinated_calls: hallucinated.length,
    steps: events.reduce((m, e) => Math.max(m, e.step), 0),
    parts_done: steps.filter((s) => s.done).length,
    parts_total: steps.length,
  };

  let failure_type: FailureType | null = null;
  const first = steps.find((s) => !s.done);
  if (!success && first) {
    if (hallucinated.length) failure_type = 'hallucinated_tool';
    else if (!first.retrieved) failure_type = 'retrieval_miss';
    else if (first.called) failure_type = 'bad_args';
    else if (otherCalls.length) failure_type = 'wrong_tool';
    else if (hitStepLimit) failure_type = 'step_limit';
    else failure_type = 'gave_up';
  }
  return { metrics, failure_type };
}

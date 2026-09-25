/**
 * Sweep runner: expands N × k × mode × task × repeat into trial specs, skips what results.jsonl already
 * has (resume), runs them with bounded concurrency, and pauses when the subscription window is nearly
 * used up. Each finished trial is appended to results.jsonl immediately.
 */
import { appendResult, existingKeys, trialKey } from './results.js';
import { runTrial, type TrialInput } from './trial.js';
import type { Backend, Mode, RateLimitState, Task, TrialRecord } from './types.js';

export interface SweepSpec {
  Ns: number[];
  ks: number[];
  modes: Mode[];
  taskIds: string[];
  repeats: number;
  backend: Backend;
  model: string;
  qaModel?: string;
  /** cross-encoder name for rerank-mode trials (part of their resume key) */
  reranker?: string;
  runId: string;
  seed: number;
}

export interface TrialSpec {
  key: string;
  taskId: string;
  N: number;
  k: number;
  mode: Mode;
  repeat: number;
}

/** Order: repeat → task → N → k → mode, so a partial run covers every config for the first tasks. */
export function expandSweep(s: SweepSpec): TrialSpec[] {
  const out: TrialSpec[] = [];
  for (let repeat = 0; repeat < s.repeats; repeat++)
    for (const taskId of s.taskIds)
      for (const N of s.Ns)
        for (const k of s.ks)
          for (const mode of s.modes) {
            const qa_model = mode === 'query_agent' ? (s.qaModel ?? s.model) : null;
            out.push({
              key: trialKey({
                run_id: s.runId,
                task_id: taskId,
                N,
                k,
                mode,
                backend: s.backend,
                model: s.model,
                qa_model,
                seed: s.seed,
                repeat,
                reranker: mode === 'rerank' ? (s.reranker ?? null) : null,
              }),
              taskId,
              N,
              k,
              mode,
              repeat,
            });
          }
  return out;
}

export interface RunnerOptions {
  spec: SweepSpec;
  tasks: Task[];
  resultsFile: string;
  concurrency: number;
  /** pause when the 5-hour window utilization reaches this fraction */
  fiveHourMax: number;
  /** everything runTrial needs besides the per-trial fields */
  base: Omit<
    TrialInput,
    | 'task'
    | 'N'
    | 'k'
    | 'mode'
    | 'repeat'
    | 'seed'
    | 'runId'
    | 'backend'
    | 'model'
    | 'qaModel'
    | 'onEvent'
  >;
  log: (line: string) => void;
  /** injectable for tests */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface RunnerSummary {
  planned: number;
  skipped: number;
  ran: number;
  passed: number;
  errored: number;
  paused_ms: number;
}

const isRateLimitError = (e: string | undefined) =>
  !!e && /rate.?limit|usage limit|too many requests|429|out of extra usage/i.test(e);

export class Pacer {
  private gate: Promise<void> = Promise.resolve();
  paused_ms = 0;
  constructor(
    private readonly log: (s: string) => void,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly now: () => number,
  ) {}

  wait(): Promise<void> {
    return this.gate;
  }

  /** Pause all workers until `untilMs` (epoch ms). Re-entrant: a longer pause extends the current one. */
  pauseUntil(untilMs: number, reason: string): void {
    const ms = Math.min(Math.max(0, untilMs - this.now()), 6 * 3600_000);
    if (ms === 0) return;
    this.log(`⏸ pausing ${(ms / 60000).toFixed(1)} min: ${reason}`);
    this.paused_ms += ms;
    this.gate = this.gate.then(() => this.sleep(ms));
  }

  /** Inspect a finished trial's window state and pause if needed. */
  observe(rl: RateLimitState | null | undefined, fiveHourMax: number): void {
    if (!rl) return;
    const fh = rl.five_hour;
    // "allowed_warning" is a heads-up (e.g. a weekly threshold), not a block; only pause when not allowed
    if (rl.status && !rl.status.startsWith('allowed'))
      this.pauseUntil(
        (fh?.resets_at ?? this.now() / 1000 + 900) * 1000 + 30_000,
        `window status "${rl.status}"`,
      );
    else if (fh && fh.utilization >= fiveHourMax)
      this.pauseUntil(
        fh.resets_at * 1000 + 30_000,
        `5-hour window at ${Math.round(fh.utilization * 100)}%`,
      );
  }
}

export async function runSweep(o: RunnerOptions): Promise<RunnerSummary> {
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const done = existingKeys(o.resultsFile);
  const all = expandSweep(o.spec);
  const queue = all.filter((t) => !done.has(t.key));
  const summary: RunnerSummary = {
    planned: all.length,
    skipped: all.length - queue.length,
    ran: 0,
    passed: 0,
    errored: 0,
    paused_ms: 0,
  };
  const tasksById = new Map(o.tasks.map((t) => [t.task_id, t]));
  const pacer = new Pacer(o.log, sleep, now);
  const attempts = new Map<string, number>();
  const t0 = now();

  const worker = async () => {
    while (queue.length) {
      await pacer.wait();
      // another worker may have taken the last trial while this one was paused
      const spec = queue.shift();
      if (!spec) break;
      const task = tasksById.get(spec.taskId);
      if (!task) throw new Error(`unknown task ${spec.taskId}`);
      const record: TrialRecord = await runTrial({
        ...o.base,
        task,
        N: spec.N,
        k: spec.k,
        mode: spec.mode,
        repeat: spec.repeat,
        seed: o.spec.seed,
        runId: o.spec.runId,
        backend: o.spec.backend,
        model: o.spec.model,
        qaModel: o.spec.qaModel,
      });
      pacer.observe(record.rate_limit, o.fiveHourMax);
      if (isRateLimitError(record.error)) {
        const n = (attempts.get(spec.key) ?? 0) + 1;
        attempts.set(spec.key, n);
        if (n <= 3) {
          queue.unshift(spec);
          pacer.pauseUntil(
            now() + 10 * 60_000,
            `rate-limited (${record.error?.slice(0, 80)}), retry ${n}/3`,
          );
          continue;
        }
      }
      appendResult(record, o.resultsFile);
      summary.ran++;
      if (record.metrics.success) summary.passed++;
      if (record.error) summary.errored++;
      const fh = record.rate_limit?.five_hour;
      const win = fh ? `  5h=${Math.round(fh.utilization * 100)}%` : '';
      const outcome = record.metrics.success
        ? 'PASS'
        : record.error
          ? `ERROR ${record.error.slice(0, 60)}`
          : `FAIL ${record.failure_type}`;
      const elapsed = ((now() - t0) / 60000).toFixed(1);
      const secs = (record.latency_ms / 1000).toFixed(0);
      o.log(
        `[${summary.skipped + summary.ran}/${all.length}] ${spec.taskId} N=${spec.N} k=${spec.k} ` +
          `${spec.mode} r${spec.repeat} → ${outcome} (${secs}s)${win}  ${elapsed}min`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));
  summary.paused_ms = pacer.paused_ms;
  return summary;
}

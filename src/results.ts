/** results.jsonl: one TrialRecord per line, keyed so an interrupted sweep can resume. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { TrialRecord } from './types.js';

export const RESULTS_FILE = 'results.jsonl';

/** Stable id for one (run, task, config, repeat) so a crashed sweep can skip what it already has. */
export function trialKey(
  p: Pick<
    TrialRecord,
    'run_id' | 'task_id' | 'N' | 'k' | 'mode' | 'backend' | 'model' | 'qa_model' | 'seed' | 'repeat'
  > & { reranker?: string | null },
): string {
  const s = [
    p.run_id,
    p.task_id,
    p.N,
    p.k,
    p.mode,
    p.backend,
    p.model,
    p.qa_model ?? '',
    p.seed,
    p.repeat,
    // appended only when set, so keys of earlier (non-rerank) trials are unchanged
    ...(p.reranker ? [p.reranker] : []),
  ].join('|');
  return createHash('sha1').update(s).digest('hex').slice(0, 12);
}

export function appendResult(record: TrialRecord, file = RESULTS_FILE): void {
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
}

export function readResults(file = RESULTS_FILE): TrialRecord[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TrialRecord);
}

export const existingKeys = (file = RESULTS_FILE): Set<string> =>
  new Set(readResults(file).map((r) => r.trial_key));

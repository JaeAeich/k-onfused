import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, wilson } from '../src/report/stats.js';
import type { TrialRecord } from '../src/types.js';

const rec = (
  over: Partial<Omit<TrialRecord, 'task'>> & { success?: boolean; hit?: boolean },
): TrialRecord => ({
  trial_key: 'x',
  run_id: 'r',
  task_id: 't',
  task: {
    prompt: 'p',
    target_tool_id: 't1',
    target_name: 'n',
    tags: { near_duplicate: false, cross_app: false, multi_step: false },
  },
  N: 1000,
  k: 10,
  mode: 'direct',
  backend: 'claude-code',
  model: 'm',
  qa_model: null,
  seed: 1,
  repeat: 0,
  gen_version: 'g1',
  started_at: '',
  latency_ms: 1000,
  usage: { input_tokens: 100, output_tokens: 10, llm_calls: 3, query_agent_llm_calls: 0 },
  cost_usd: 0,
  metrics: {
    search_hit: over.hit ?? true,
    retrieval_hit: over.hit ?? true,
    selection_correct: over.success ?? true,
    args_correct: over.success ?? true,
    success: over.success ?? true,
    extra_calls: 0,
    hallucinated_calls: 0,
    steps: 3,
  },
  failure_type: over.success === false ? 'wrong_tool' : null,
  events: [],
  ...over,
});

test('wilson interval', () => {
  const w = wilson(8, 10);
  assert.equal(w.p, 0.8);
  assert.ok(w.lo > 0.45 && w.lo < 0.5 && w.hi > 0.94 && w.hi < 0.96);
  assert.ok(Number.isNaN(wilson(0, 0).p));
});

test('aggregate groups by mode/model/N/k and computes conditional rates', () => {
  const cells = aggregate([
    rec({}),
    rec({ success: false }),
    rec({ success: false, hit: false }),
    rec({ k: 3 }),
  ]);
  assert.equal(cells.length, 2);
  const c10 = cells.find((c) => c.k === 10)!;
  assert.equal(c10.n, 3);
  assert.equal(c10.success.p, 1 / 3);
  assert.equal(c10.retrieval_hit.p, 2 / 3);
  assert.equal(c10.selection_given_hit.n, 2);
  assert.equal(c10.failures.wrong_tool, 2);
  assert.equal(c10.mean_llm_calls, 3);
});

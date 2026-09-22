import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, argsMatch } from '../src/grade.js';
import type { Task, TraceEvent } from '../src/types.js';

const task: Task = {
  task_id: 't001',
  prompt: 'x',
  target_tool_ids: ['t5'],
  expected_calls: [
    {
      tool_id: 't5',
      args: {
        issue_id: { eq: '42' },
        title: { ieq: 'Fix Login' },
        labels: { includes: ['bug'] },
        'assignee.email': { eq: 'a@b.c' },
      },
    },
  ],
  tags: { near_duplicate: false, cross_app: false, multi_step: false },
};
const good = {
  issue_id: '42',
  title: '  fix login ',
  labels: ['p1', 'Bug'],
  assignee: { email: 'a@b.c' },
};
const retrieval = (ids: string[]): TraceEvent => ({
  type: 'retrieval',
  step: 1,
  need: 'q',
  hits: ids.map((id) => ({ tool_id: id, score: 0.5 })),
  latency_ms: 1,
});
const call = (tool_id: string | null, args: unknown, valid = true): TraceEvent => ({
  type: 'tool_call',
  step: 2,
  tool_name: tool_id ?? 'ghost',
  tool_id,
  args,
  valid,
  response: {},
});
const fin: TraceEvent = { type: 'finish', step: 3, status: 'completed', summary: '' };

test('argsMatch: eq / ieq / includes / dotted paths', () => {
  assert.ok(argsMatch(good, task.expected_calls[0]!.args));
  assert.ok(!argsMatch({ ...good, issue_id: '43' }, task.expected_calls[0]!.args));
  assert.ok(!argsMatch({ ...good, labels: ['p1'] }, task.expected_calls[0]!.args));
});

test('failure precedence', () => {
  const g = (events: TraceEvent[], stepLimit = false) => grade(task, events, stepLimit);
  assert.equal(g([retrieval(['t5']), call('t5', good), fin]).failure_type, null);
  // a hallucinated call that the model recovers from is a metric, not a failure
  const rec = g([retrieval(['t5']), call(null, {}), call('t5', good), fin]);
  assert.equal(rec.failure_type, null);
  assert.equal(rec.metrics.hallucinated_calls, 1);
  assert.equal(
    g([retrieval(['t5']), call(null, {}), call('t2', {}), fin]).failure_type,
    'hallucinated_tool',
  );
  assert.equal(g([retrieval(['t1', 't2']), call('t1', {}), fin]).failure_type, 'retrieval_miss');
  assert.equal(g([retrieval(['t5']), call('t2', {}), fin]).failure_type, 'wrong_tool');
  assert.equal(
    g([retrieval(['t5']), call('t5', { issue_id: '9' }, false), fin]).failure_type,
    'bad_args',
  );
  assert.equal(
    g([retrieval(['t5']), { ...fin, status: 'cannot_complete' }]).failure_type,
    'gave_up',
  );
  assert.equal(g([retrieval(['t5'])], true).failure_type, 'step_limit');
  const m = g([retrieval(['t5']), call('t2', {}), call('t5', good), fin]).metrics;
  assert.ok(m.success);
  assert.equal(m.extra_calls, 1);
});

test('multi-step: every part must be done; chained id must come from the first call', () => {
  const chain: Task = {
    task_id: 't031',
    prompt: 'x',
    target_tool_ids: ['t1', 't2'],
    expected_calls: [
      { tool_id: 't1', args: { title: { ieq: 'A' } } },
      { tool_id: 't2', args: { issue_id: { ref: 0 } } },
    ],
    tags: { near_duplicate: false, cross_app: false, multi_step: true },
  };
  const created = (id: string): TraceEvent => ({
    type: 'tool_call',
    step: 2,
    tool_name: 'create',
    tool_id: 't1',
    args: { title: 'a' },
    valid: true,
    response: { ok: true, id },
  });
  const g = (events: TraceEvent[]) => grade(chain, events, false);
  const both = retrieval(['t1', 't2']);
  const ok = g([both, created('777'), call('t2', { issue_id: '777' }), fin]);
  assert.equal(ok.failure_type, null);
  assert.equal(ok.metrics.parts_done, 2);
  // made-up id for step 2 → bad_args, partial credit 1/2
  const guessed = g([both, created('777'), call('t2', { issue_id: '1' }), fin]);
  assert.equal(guessed.failure_type, 'bad_args');
  assert.equal(guessed.metrics.parts_done, 1);
  // stopped after step 1
  assert.equal(g([both, created('777'), fin]).failure_type, 'gave_up');
  // step 2 target never delivered
  const miss = g([retrieval(['t1']), created('777'), fin]);
  assert.equal(miss.failure_type, 'retrieval_miss');
  assert.equal(miss.metrics.retrieval_hit, false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spanTreeFromRecord } from '../src/telemetry.js';
import type { TrialRecord } from '../src/types.js';

test('spanTreeFromRecord nests query-agent activity under request_tools inside the worker turn', () => {
  const t0 = Date.parse('2026-09-26T10:00:00Z');
  const r: TrialRecord = {
    trial_key: 'k',
    run_id: 'r',
    task_id: 't001',
    task: {
      prompt: 'p',
      target_tool_id: 't1',
      target_name: 'n',
      tags: { near_duplicate: false, cross_app: false, multi_step: false },
    },
    N: 1000,
    k: 3,
    mode: 'query_agent',
    backend: 'claude-code',
    model: 'm',
    qa_model: 'm',
    seed: 1,
    repeat: 0,
    gen_version: 'g2',
    started_at: new Date(t0).toISOString(),
    latency_ms: 5000,
    usage: { input_tokens: 1, output_tokens: 1, llm_calls: 2, query_agent_llm_calls: 1 },
    cost_usd: 0,
    metrics: {
      search_hit: true,
      retrieval_hit: true,
      selection_correct: true,
      args_correct: true,
      success: true,
      extra_calls: 0,
      hallucinated_calls: 0,
      steps: 3,
    },
    failure_type: null,
    events: [
      {
        type: 'llm_call',
        step: 1,
        agent: 'worker',
        model: 'm',
        input_tokens: 1,
        output_tokens: 1,
        latency_ms: 100,
        finish_reason: '',
        text: '',
        n_tools: 2,
        ts: t0 + 100,
      },
      {
        type: 'llm_call',
        step: 2,
        agent: 'query_agent',
        model: 'm',
        input_tokens: 1,
        output_tokens: 1,
        latency_ms: 100,
        finish_reason: '',
        text: '',
        n_tools: 2,
        ts: t0 + 300,
      },
      {
        type: 'search',
        step: 2,
        agent: 'query_agent',
        query: 'q',
        filters: { app: 'a' },
        N: 1000,
        k: 3,
        hits: [{ tool_id: 't1', score: 0.9 }],
        latency_ms: 10,
        ts: t0 + 400,
      },
      {
        type: 'retrieval',
        step: 2,
        need: 'need',
        hits: [{ tool_id: 't1', score: 0.9 }],
        latency_ms: 500,
        ts: t0 + 700,
      },
      {
        type: 'llm_call',
        step: 3,
        agent: 'worker',
        model: 'm',
        input_tokens: 1,
        output_tokens: 1,
        latency_ms: 100,
        finish_reason: '',
        text: '',
        n_tools: 3,
        ts: t0 + 900,
      },
      {
        type: 'tool_call',
        step: 3,
        tool_name: 'n',
        tool_id: 't1',
        args: { a: 1 },
        valid: true,
        response: { ok: true },
        ts: t0 + 1000,
      },
      { type: 'finish', step: 3, status: 'completed', summary: 's', ts: t0 + 1100 },
    ],
  };
  const root = spanTreeFromRecord(r);
  assert.equal(root.kind, 'CHAIN');
  assert.deepEqual(
    root.children.map((c) => c.name),
    ['worker turn 1', 'worker turn 3', 'grade'],
  );
  const turn1 = root.children[0]!;
  assert.deepEqual(
    turn1.children.map((c) => c.name),
    ['request_tools'],
  );
  const req = turn1.children[0]!;
  assert.deepEqual(
    req.children.map((c) => [c.name, c.kind]),
    [
      ['query_agent turn 2', 'LLM'],
      ['search_tools', 'RETRIEVER'],
    ],
  );
  assert.equal(req.start, t0 + 200); // starts with the first query-agent turn
  assert.equal(req.end, t0 + 700);
  assert.equal(req.children[1]!.attributes['eval.target_rank'], 1);
  const turn3 = root.children[1]!;
  assert.deepEqual(
    turn3.children.map((c) => [c.name, c.attributes['eval.is_target']]),
    [
      ['n', true],
      ['finish', undefined],
    ],
  );
  assert.equal(root.attributes['eval.success'], true);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockExecutor } from '../src/exec/mock.js';
import { WorkerSession } from '../src/agents/session-worker.js';
import { QuerySession } from '../src/agents/session-query.js';
import { Trace } from '../src/trace.js';
import { makeRng } from '../src/rng.js';
import type { RetrievalResult, Retriever, ToolDef } from '../src/types.js';
import type { ToolIndex } from '../src/index/qdrant.js';
import type { Embedder } from '../src/index/embed.js';

const tool = (id: string, name: string): ToolDef => ({
  tool_id: id,
  name,
  description: `${name} desc`,
  category: 'c',
  app: 'a',
  app_display: 'A',
  resource: 'r',
  action: 'x',
  variation_id: 'base',
  rank: 1,
  input_schema: {
    type: 'object',
    properties: {
      issue_id: { type: 'string', pattern: '^[0-9]+$' },
      labels: { type: 'array', items: { type: 'string' }, minItems: 1 },
    },
    required: ['issue_id'],
    additionalProperties: false,
  },
});
const T1 = tool('t1', 'github_label_issue_by_id');
const T2 = tool('t2', 'gitlab_label_issue_by_id');

/** A retriever that always returns the same tools. */
const fixedRetriever = (tools: ToolDef[]): Retriever => ({
  async retrieve(query): Promise<RetrievalResult> {
    return {
      query,
      hits: tools.map((t) => ({ tool_id: t.tool_id, score: 0.9 })),
      tools,
      latency_ms: 1,
    };
  },
});

test('MockExecutor validates against the schema and never reveals the target', () => {
  const ex = new MockExecutor(makeRng('s'));
  assert.equal(ex.execute(T1, { issue_id: '42', labels: ['bug'] }).valid, true);
  const bad = ex.execute(T1, { issue_id: 'abc' });
  assert.equal(bad.valid, false);
  assert.match(String((bad.response as { details: string }).details), /pattern/);
  assert.equal(ex.execute(T1, { issue_id: '1', extra: true }).valid, false); // additionalProperties: false
});

test('WorkerSession: tools appear after request_tools, calls are traced, finish ends the session', async () => {
  const trace = new Trace();
  const w = new WorkerSession(trace, 'mcp__ts__', {
    retriever: fixedRetriever([T1, T2]),
    executor: new MockExecutor(makeRng('s')),
    N: 100,
    pinned: [],
    k: 2,
    maxRequestTools: 1,
  });
  assert.deepEqual(
    w.listTools().map((t) => t.name),
    ['request_tools', 'finish'],
  );

  const r1 = await w.call('mcp__ts__request_tools', { need: 'label an issue' });
  assert.equal(r1.listChanged, true);
  assert.deepEqual(
    (r1.output as { tools: { name: string }[] }).tools.map((t) => t.name),
    ['mcp__ts__github_label_issue_by_id', 'mcp__ts__gitlab_label_issue_by_id'],
  );
  assert.equal(w.listTools().length, 4);

  const r2 = await w.call('mcp__ts__request_tools', { need: 'again' });
  assert.match(String((r2.output as { error: string }).error), /limit/);

  const r3 = await w.call('mcp__ts__github_label_issue_by_id', { issue_id: '7', labels: ['p1'] });
  assert.equal((r3.output as { ok: boolean }).ok, true);
  await w.call('mcp__ts__ghost_tool', {}); // unknown → traced as hallucinated, not thrown
  await w.call('mcp__ts__finish', { status: 'completed', summary: 'done' });
  assert.equal(w.isDone(), true);

  const types = trace.events.map((e) => e.type);
  assert.deepEqual(types, ['retrieval', 'tool_call', 'tool_call', 'finish']);
  const calls = trace.events.filter((e) => e.type === 'tool_call');
  assert.equal(calls[0]!.tool_id, 't1');
  assert.equal(calls[1]!.tool_id, null);
});

test('QuerySession: filtered searches are traced; return_tools keeps only seen names, capped at k', async () => {
  const trace = new Trace();
  const searched: unknown[] = [];
  const index = {
    search: async (
      _v: number[],
      cat: { N: number; pinned: string[] },
      k: number,
      filters?: unknown,
    ) => {
      searched.push({ ...cat, k, filters });
      return [
        { tool_id: 't1', score: 0.8 },
        { tool_id: 't2', score: 0.7 },
      ];
    },
  } as unknown as ToolIndex;
  const embedder = { embedQuery: async () => [0, 1] } as unknown as Embedder;
  const q = new QuerySession(trace, '', {
    index,
    embedder,
    toolsById: new Map([
      [T1.tool_id, T1],
      [T2.tool_id, T2],
    ]),
    N: 500,
    pinned: ['t9'],
    k: 1,
    maxSearches: 1,
  });

  const s1 = await q.call('search_tools', { query: 'label issue', app: 'GitHub' });
  assert.deepEqual(searched, [{ N: 500, pinned: ['t9'], k: 1, filters: { app: 'github' } }]); // filters lower-cased
  assert.equal((s1.output as { candidates: unknown[] }).candidates.length, 2);
  const s2 = await q.call('search_tools', { query: 'again' });
  assert.match(String((s2.output as { error: string }).error), /limit/);

  await q.call('return_tools', {
    tool_names: ['nonexistent', 'gitlab_label_issue_by_id', 'github_label_issue_by_id'],
  });
  assert.deepEqual(q.returned, [{ tool_id: 't2', score: 0.7 }]); // unseen name dropped, then capped at k=1
  assert.equal(q.isDone(), true);
  assert.equal(trace.events.filter((e) => e.type === 'search').length, 1);
});

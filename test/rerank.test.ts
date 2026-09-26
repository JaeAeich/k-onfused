import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RerankRetriever } from '../src/agents/retrievers.js';
import { trialKey } from '../src/results.js';
import { Trace } from '../src/trace.js';
import type { ToolDef } from '../src/types.js';
import type { ToolIndex } from '../src/index/qdrant.js';
import type { Embedder } from '../src/index/embed.js';
import type { Reranker } from '../src/index/rerank.js';

const tool = (i: number): ToolDef => ({
  tool_id: `t${i}`,
  name: `tool_${i}`,
  description: `desc ${i}`,
  category: 'c',
  app: 'a',
  app_display: 'A',
  resource: 'r',
  action: 'x',
  variation_id: 'base',
  rank: i,
  input_schema: { type: 'object' },
});

test('RerankRetriever: searches deep, re-orders by cross-encoder score, hands back top k', async () => {
  const tools = Array.from({ length: 6 }, (_, i) => tool(i));
  const asked: number[] = [];
  const index = {
    search: async (_v: number[], _cat: unknown, k: number) => {
      asked.push(k);
      return tools.slice(0, k).map((t, i) => ({ tool_id: t.tool_id, score: 1 - i / 10 }));
    },
  } as unknown as ToolIndex;
  const embedder = { embedQuery: async () => [0] } as unknown as Embedder;
  // favours higher ids: t5 > t4 > …
  const reranker = {
    name: 'fake',
    score: async (_q: string, docs: string[]) => docs.map((d) => Number(/desc (\d+)/.exec(d)![1])),
  } as unknown as Reranker;
  const trace = new Trace();
  const r = await new RerankRetriever(
    { index, embedder, toolsById: new Map(tools.map((t) => [t.tool_id, t])), trace },
    reranker,
    5,
  ).retrieve('q', { N: 100, pinned: [], k: 2 });
  assert.deepEqual(asked, [5]);
  assert.deepEqual(
    r.hits.map((h) => h.tool_id),
    ['t4', 't3'],
  );
  assert.equal(r.reranker?.model, 'fake');
  assert.equal(r.reranker?.candidates, 5);
  const search = trace.events.find((e) => e.type === 'search');
  assert.equal(search?.type === 'search' && search.hits.length, 5); // raw search keeps all candidates
});

test('trialKey: unchanged for trials without a reranker, distinct per reranker', () => {
  const base = {
    run_id: 'r',
    task_id: 't001',
    N: 100,
    k: 3,
    mode: 'direct' as const,
    backend: 'claude-code' as const,
    model: 'm',
    qa_model: null,
    seed: 1,
    repeat: 0,
  };
  assert.equal(trialKey(base), trialKey({ ...base, reranker: null }));
  const a = trialKey({ ...base, mode: 'rerank', reranker: 'minilm' });
  const b = trialKey({ ...base, mode: 'rerank', reranker: 'bge-m3' });
  assert.notEqual(a, b);
});

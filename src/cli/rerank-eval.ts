/**
 * Offline re-ranker evaluation (no LLM): replay the search phrases the agent actually sent in a run,
 * take the vector search's top `depth` candidates from the same catalog, and ask where each target lands
 * before and after re-ranking. "Hit@k" = target in the top k for at least one of the trial's searches,
 * which is the recall@k a live trial would have seen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { collectionName } from '../config.js';
import { readTools } from '../data.js';
import { Embedder, toolEmbedText } from '../index/embed.js';
import { ToolIndex } from '../index/qdrant.js';
import { RERANKERS, Reranker, type RerankerName } from '../index/rerank.js';
import { RESULTS_FILE, readResults } from '../results.js';
import { targetsOf } from '../report/stats.js';

const o = new Command()
  .requiredOption('--run-id <id>', 'run whose recorded search phrases to replay')
  .option('--mode <mode>', 'which trials to take phrases from', 'direct')
  .option(
    '--models <list>',
    `re-rankers: ${Object.keys(RERANKERS).join(', ')}`,
    Object.keys(RERANKERS).join(','),
  )
  .option('--depth <n>', 'vector-search candidates to re-rank', '50')
  .option('--results <file>', 'results JSONL', RESULTS_FILE)
  .parse()
  .opts();

const depth = Number(o.depth);
const models = String(o.models).split(',') as RerankerName[];
const { header, rows: tools } = readTools();
const byId = new Map(tools.map((t) => [t.tool_id, t]));
const index = new ToolIndex(collectionName(header.gen_version));
const embedder = new Embedder();
const records = readResults(o.results).filter((r) => r.run_id === o.runId && r.mode === o.mode);
if (!records.length) throw new Error(`no ${o.mode} trials in run ${o.runId}`);

// 1. candidates per (search phrase, catalog), shared by every re-ranker
interface Query {
  N: number;
  need: string;
  candidates: string[];
}
const queries = new Map<string, Query>();
interface Item {
  N: number;
  target: string;
  queryKeys: string[];
}
const items: Item[] = [];
for (const r of records) {
  const targets = targetsOf(r);
  const keys: string[] = [];
  for (const e of r.events) {
    if (e.type !== 'retrieval') continue;
    const key = `${r.N}|${targets.join(',')}|${e.need}`;
    if (!queries.has(key)) {
      const hits = await index.search(
        await embedder.embedQuery(e.need),
        { N: r.N, pinned: targets },
        depth,
      );
      queries.set(key, { N: r.N, need: e.need, candidates: hits.map((h) => h.tool_id) });
    }
    keys.push(key);
  }
  for (const t of targets) items.push({ N: r.N, target: t, queryKeys: keys });
}
console.log(
  `${records.length} ${o.mode} trials of ${o.runId} → ${items.length} targets,` +
    ` ${queries.size} distinct searches, top-${depth} candidates each`,
);

// 2. order of candidates per ranker: 'embedding' = as returned, else sorted by cross-encoder score
const orders = new Map<string, Map<string, string[]>>([
  ['embedding', new Map([...queries].map(([k, q]) => [k, q.candidates]))],
]);
const latency = new Map<string, number[]>();
for (const name of models) {
  const rr = new Reranker(name);
  const ord = new Map<string, string[]>();
  const ms: number[] = [];
  let n = 0;
  for (const [k, q] of queries) {
    const t0 = Date.now();
    const scores = await rr.score(
      q.need,
      q.candidates.map((id) => toolEmbedText(byId.get(id)!)),
    );
    if (n++ > 0) ms.push(Date.now() - t0); // first call includes model load
    ord.set(
      k,
      q.candidates
        .map((id, i) => ({ id, s: scores[i]! }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.id),
    );
    if (process.stdout.isTTY) process.stdout.write(`\r  ${name}: ${n}/${queries.size}`);
  }
  console.log(`  ${name}: ${queries.size} searches re-ranked`);
  orders.set(name, ord);
  latency.set(name, ms);
}

// 3. best rank of each target over its trial's searches
const bestRank = (ranker: string, it: Item) =>
  Math.min(
    ...it.queryKeys.map((k) => {
      const i = orders.get(ranker)!.get(k)!.indexOf(it.target);
      return i < 0 ? Infinity : i + 1;
    }),
    Infinity,
  );
const Ns = [...new Set(items.map((i) => i.N))].sort((a, b) => a - b);
const ks = [1, 3, 10];
const rows: (string | number)[][] = [];
for (const N of Ns) {
  const its = items.filter((i) => i.N === N);
  for (const ranker of orders.keys()) {
    const ranks = its.map((it) => bestRank(ranker, it));
    const ms = latency.get(ranker) ?? [];
    const med = ms.length ? [...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)]! : 0;
    rows.push([
      N,
      ranker,
      its.length,
      ...ks.map((k) => ranks.filter((r) => r <= k).length / ranks.length),
      ranks.filter((r) => r <= depth).length / ranks.length,
      med,
    ]);
  }
}
const pct = (x: number | string) => (typeof x === 'number' ? `${Math.round(x * 100)}%` : x);
console.log(`\nN        ranker      n   hit@1  hit@3  hit@10  in top-${depth}  ms/search (median)`);
for (const r of rows)
  console.log(
    `${String(r[0]).padEnd(8)} ${String(r[1]).padEnd(10)} ${String(r[2]).padStart(3)}   ` +
      `${[r[3], r[4], r[5], r[6]].map((x) => pct(x!).padStart(5)).join('  ')}` +
      `     ${r[1] === 'embedding' ? '–' : r[7]}`,
  );

const out = path.join('results', o.runId, `rerank-offline-${o.mode}.csv`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  ['N,ranker,targets,hit_at_1,hit_at_3,hit_at_10,hit_at_depth,median_ms_per_search,depth']
    .concat(rows.map((r) => [...r, depth].join(',')))
    .join('\n') + '\n',
);
console.log(`→ ${out}`);

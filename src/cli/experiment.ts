import { Command } from 'commander';
import { Bridge } from '../cc/bridge.js';
import { collectionName, config } from '../config.js';
import { readTasks, readTools } from '../data.js';
import { expandSweep, runSweep, type SweepSpec } from '../experiment.js';
import { Embedder } from '../index/embed.js';
import { RERANKERS, Reranker, type RerankerName } from '../index/rerank.js';
import { ToolIndex } from '../index/qdrant.js';
import { RESULTS_FILE, existingKeys, expandTaskIds } from '../results.js';
import { flushTelemetry, telemetryEnabled } from '../telemetry.js';
import type { Backend, Mode } from '../types.js';

const csvNums = (s: string) =>
  s
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => !Number.isNaN(x));
const o = new Command()
  .option('--N <list>', 'catalog sizes', '100,1000,10000,100000,200000')
  .option('--k <list>', 'tools per search', '3,5,10,20,50,100')
  .option('--mode <list>', 'direct,rerank,query_agent', 'direct,query_agent')
  .option(
    '--reranker <name>',
    `cross-encoder for rerank mode: ${Object.keys(RERANKERS).join(' | ')}`,
    config.reranker,
  )
  .option('--tasks <sel>', 'all | first:<n> | t001,t002 | t001-t015', 'all')
  .option('--repeats <n>', 'repeats per configuration', '3')
  .option('--concurrency <n>', 'parallel trials', '2')
  .option('--backend <b>', 'claude-code | openrouter', config.backend)
  .option('--model <id>', 'worker model')
  .option('--qa-model <id>', 'query agent model (defaults to --model)')
  .option(
    '--run-id <id>',
    'run id (part of the resume key)',
    `exp-${new Date().toISOString().slice(0, 10)}`,
  )
  .option('--seed <n>', 'run seed', String(config.seeds.run))
  .option('--results <file>', 'results JSONL', RESULTS_FILE)
  .option('--five-hour-max <frac>', 'pause when the 5-hour window reaches this utilization', '0.92')
  .option('--dry-run', 'print the plan and exit')
  .parse()
  .opts();

const backend = o.backend as Backend;
const model: string = o.model ?? (backend === 'claude-code' ? config.ccModel : config.workerModel);
const { header, rows: tools } = readTools();
const { header: th, rows: tasks } = readTasks();
if (th.gen_version !== header.gen_version)
  throw new Error('tools/tasks gen_version mismatch; re-run npm run gen');

const taskIds =
  o.tasks === 'all'
    ? tasks.map((t) => t.task_id)
    : o.tasks.startsWith('first:')
      ? tasks.slice(0, Number(o.tasks.slice(6))).map((t) => t.task_id)
      : expandTaskIds(String(o.tasks));
const Ns = csvNums(o.N).filter((N) => {
  if (N > tools.length) console.warn(`skipping N=${N}: only ${tools.length} tools indexed`);
  return N <= tools.length;
});

const spec: SweepSpec = {
  Ns,
  ks: csvNums(o.k),
  modes: String(o.mode)
    .split(',')
    .map((m) => m.trim() as Mode),
  taskIds,
  repeats: Number(o.repeats),
  backend,
  model,
  qaModel: o.qaModel,
  reranker: o.reranker,
  runId: o.runId,
  seed: Number(o.seed),
};
const plan = expandSweep(spec);
const have = existingKeys(o.results);
const todo = plan.filter((t) => !have.has(t.key)).length;
console.log(
  `run ${spec.runId}: ${plan.length} trials planned (${plan.length - todo} already in ${o.results}, ${todo} to run)` +
    ` · N=${Ns.join(',')} k=${spec.ks.join(',')} modes=${spec.modes.join(',')}` +
    ` tasks=${taskIds.length} repeats=${spec.repeats} model=${model} concurrency=${o.concurrency}`,
);
if (o.dryRun) process.exit(0);

const index = new ToolIndex(collectionName(header.gen_version));
if (!(await index.client.collectionExists(index.collection)).exists)
  throw new Error(`collection ${index.collection} missing; run npm run index`);
const bridge = backend === 'claude-code' ? await new Bridge().start() : undefined;
try {
  const summary = await runSweep({
    spec,
    tasks,
    resultsFile: o.results,
    concurrency: Number(o.concurrency),
    fiveHourMax: Number(o.fiveHourMax),
    base: {
      tools,
      genVersion: header.gen_version,
      index,
      embedder: new Embedder(),
      bridge,
      reranker: spec.modes.includes('rerank')
        ? new Reranker(o.reranker as RerankerName)
        : undefined,
    },
    log: (line) => console.log(line),
  });
  if (telemetryEnabled()) console.log(`traces exported to ${config.otlpEndpoint}`);
  console.log(
    `done: ran ${summary.ran} (${summary.passed} pass, ${summary.errored} errors),` +
      ` skipped ${summary.skipped}, paused ${(summary.paused_ms / 60000).toFixed(0)} min`,
  );
} finally {
  bridge?.close();
  await flushTelemetry();
}

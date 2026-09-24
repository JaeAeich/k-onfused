import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { collectionName, config } from '../config.js';
import { readTasks, readTools } from '../data.js';
import { Embedder } from '../index/embed.js';
import { RERANKERS, Reranker, type RerankerName } from '../index/rerank.js';
import { ToolIndex } from '../index/qdrant.js';
import { Bridge } from '../cc/bridge.js';
import { runTrial } from '../trial.js';
import { appendResult } from '../results.js';
import { flushTelemetry, telemetryEnabled } from '../telemetry.js';
import { eventLine, summaryLines } from './print.js';
import type { Backend, Mode } from '../types.js';

const o = new Command()
  .requiredOption('--task <id>', 'task id, e.g. t001')
  .option('--N <n>', 'simulated catalog size', String(1000))
  .option('--k <n>', 'tools returned per search', String(10))
  .option('--mode <mode>', 'direct | rerank | query_agent', 'direct')
  .option(
    '--reranker <name>',
    `cross-encoder for rerank mode: ${Object.keys(RERANKERS).join(' | ')}`,
    config.reranker,
  )
  .option('--backend <b>', 'claude-code | openrouter', config.backend)
  .option('--model <id>', 'worker model (Claude Code alias/id, or OpenRouter id)')
  .option('--qa-model <id>', 'query agent model (defaults to --model)')
  .option('--seed <n>', 'run seed', String(config.seeds.run))
  .option('--repeat <n>', 'repeat index', '0')
  .option('--run-id <id>', 'run id', 'adhoc')
  .option('--results <file>', 'also append the record to this JSONL file')
  .option('--quiet', 'no live output')
  .parse()
  .opts();

const backend = o.backend as Backend;
const mode = o.mode as Mode;
const model: string = o.model ?? (backend === 'claude-code' ? config.ccModel : config.workerModel);

const { header, rows: tools } = readTools();
const { header: taskHeader, rows: tasks } = readTasks();
if (taskHeader.gen_version !== header.gen_version)
  throw new Error('tools/tasks gen_version mismatch; re-run npm run gen');
const task = tasks.find((t) => t.task_id === o.task);
if (!task)
  throw new Error(`no task ${o.task} (have ${tasks[0]?.task_id}..${tasks.at(-1)?.task_id})`);

const index = new ToolIndex(collectionName(header.gen_version));
if (!(await index.client.collectionExists(index.collection)).exists)
  throw new Error(`collection ${index.collection} missing; run npm run index`);

const byId = new Map(tools.map((t) => [t.tool_id, t]));
const targetIds = task.target_tool_ids;
const log = o.quiet ? () => {} : (s: string) => console.log(s);
log(`task ${task.task_id}: "${task.prompt}"`);
log(`N=${o.N} k=${o.k} mode=${mode} backend=${backend} model=${model}`);
for (const x of task.expected_calls)
  log(
    `target: ${byId.get(x.tool_id)!.name} (${x.tool_id})  expected args: ${JSON.stringify(x.args)}`,
  );

const bridge = backend === 'claude-code' ? await new Bridge().start() : undefined;
try {
  const record = await runTrial({
    task,
    tools,
    genVersion: header.gen_version,
    N: Number(o.N),
    k: Number(o.k),
    mode,
    backend,
    model,
    qaModel: o.qaModel,
    seed: Number(o.seed),
    repeat: Number(o.repeat),
    runId: o.runId,
    index,
    embedder: new Embedder(),
    bridge,
    reranker: mode === 'rerank' ? new Reranker(o.reranker as RerankerName) : undefined,
    onEvent: (e) => log(eventLine(e, { byId, targetIds })),
  });
  fs.mkdirSync(config.runsDir, { recursive: true });
  const out = path.join(config.runsDir, `${record.trial_key}.json`);
  fs.writeFileSync(out, JSON.stringify(record, null, 2));
  if (o.results) appendResult(record, o.results);
  const exported = telemetryEnabled() ? `, exported to ${config.otlpEndpoint}` : '';
  console.log(
    '\n' +
      summaryLines(record).join('\n') +
      `\ntrace → ${out}${o.results ? `, appended to ${o.results}` : ''}${exported}`,
  );
} finally {
  bridge?.close();
  await flushTelemetry();
}

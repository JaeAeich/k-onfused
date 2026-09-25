import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { Command } from 'commander';
import { config } from '../config.js';
import { readTasks, readTools, tasksFile, toolsFile } from '../data.js';
import { RESULTS_FILE, readResults } from '../results.js';
import { buildReportHtml } from '../report/html.js';
import { targetsOf, uniqueSorted } from '../report/stats.js';
import { buildWriteup, type Manifest } from '../report/writeup.js';
import { WORKER_SYSTEM_PROMPT } from '../agents/session-worker.js';

const o = new Command()
  .requiredOption('--run-id <id>', 'run to write up')
  .option('--results <file>', 'results JSONL', RESULTS_FILE)
  .option('--out <dir>', 'output folder (default results/<run-id>)')
  .parse()
  .opts();

const records = readResults(o.results).filter((r) => r.run_id === o.runId);
if (!records.length) throw new Error(`no trials with run_id ${o.runId} in ${o.results}`);
const out = o.out ?? path.join('results', o.runId);
const { header: toolsHeader, rows: tools } = readTools();
const { header: tasksHeader, rows: tasks } = readTasks();

// names for every tool the records mention (targets, hits, calls) plus the tasks' expected calls
const ids = new Set<string>();
for (const r of records) {
  for (const id of targetsOf(r)) ids.add(id);
  for (const e of r.events) {
    if (e.type === 'search' || e.type === 'retrieval') for (const h of e.hits) ids.add(h.tool_id);
    if (e.type === 'tool_call' && e.tool_id) ids.add(e.tool_id);
  }
}
for (const t of tasks) for (const x of t.expected_calls) ids.add(x.tool_id);
const names = new Map(tools.filter((t) => ids.has(t.tool_id)).map((t) => [t.tool_id, t.name]));

const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sh = (cmd: string) => {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};
const u = <T>(xs: T[]) => uniqueSorted(xs);
const taskIds = u(records.map((r) => r.task_id));
const models = u(records.map((r) => r.model));
const qaModels = u(records.map((r) => r.qa_model).filter((x): x is string => !!x));
const multi = tasks.filter((t) => t.tags.multi_step).length;
const started = records.map((r) => r.started_at).sort();

const manifest: Manifest = {
  run_id: o.runId,
  generated_at: new Date().toISOString(),
  command: [
    'npm run experiment --',
    `--N ${u(records.map((r) => r.N)).join(',')}`,
    `--k ${u(records.map((r) => r.k)).join(',')}`,
    `--mode ${u(records.map((r) => r.mode)).join(',')}`,
    `--tasks ${taskIds.join(',')}`,
    `--repeats ${Math.max(...records.map((r) => r.repeat)) + 1}`,
    `--model ${models.join(',')}`,
    ...(qaModels.length && qaModels.join() !== models.join()
      ? [`--qa-model ${qaModels.join(',')}`]
      : []),
    ...u(records.map((r) => r.reranker).filter((x): x is string => !!x)).map(
      (x) => `--reranker ${x}`,
    ),
    `--seed ${u(records.map((r) => r.seed)).join(',')}`,
    `--run-id ${o.runId}`,
  ].join(' '),
  trials: records.length,
  errors: records.filter((r) => r.error).length,
  first_trial_at: started[0]!,
  last_trial_at: started.at(-1)!,
  backend: u(records.map((r) => r.backend)),
  models,
  qa_models: qaModels,
  modes: u(records.map((r) => r.mode)),
  N: u(records.map((r) => r.N)),
  k: u(records.map((r) => r.k)),
  tasks: taskIds,
  repeats: Math.max(...records.map((r) => r.repeat)) + 1,
  seed: u(records.map((r) => r.seed)),
  gen_version: u(records.map((r) => r.gen_version)),
  gen_command:
    `npm run gen -- --count ${toolsHeader.count} --tasks ${tasks.length - multi}` +
    ` --multi ${multi} --seed ${toolsHeader.seed} --task-seed ${tasksHeader.task_seed} --quiet`,
  data: {
    tools_file: toolsFile(),
    tools_sha256: sha(toolsFile()),
    tasks_file: tasksFile(),
    tasks_sha256: sha(tasksFile()),
  },
  knobs: {
    worker_turns_per_part: config.stepCap,
    worker_searches_per_part: config.maxRequestTools,
    query_agent_turns: config.qaStepCap,
    query_agent_searches: config.qaMaxSearches,
    embedding_model: config.embedModel,
    timeout_ms_per_part: config.ccTimeoutMs,
    rerank_candidates: config.rerankDepth,
  },
  env: {
    node: process.version,
    'claude code': sh('claude --version').replace(/\s*\(Claude Code\)/, ''),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    qdrant: config.qdrantUrl,
  },
};

const findingsFile = path.join(out, 'FINDINGS.md');
const files = buildWriteup({
  records,
  tasks,
  names,
  manifest,
  workerPrompt: WORKER_SYSTEM_PROMPT,
  findings: fs.existsSync(findingsFile) ? fs.readFileSync(findingsFile, 'utf8') : null,
});
files['report.html'] = buildReportHtml(records, tools);
for (const [rel, content] of Object.entries(files)) {
  const p = path.join(out, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
console.log(
  `results ${o.runId}: ${records.length} trials → ${out}/ (${Object.keys(files).join(', ')})`,
);

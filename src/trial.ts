import { config } from './config.js';
import { MockExecutor } from './exec/mock.js';
import { grade } from './grade.js';
import { makeRng } from './rng.js';
import { Trace } from './trace.js';
import { trialKey } from './results.js';
import { exportTrial } from './telemetry.js';
import { vendorOf } from './gen/tools.js';
import type { Bridge } from './cc/bridge.js';
import type { Embedder } from './index/embed.js';
import type { ToolIndex } from './index/qdrant.js';
import type { Backend, Catalog, Mode, Task, ToolDef, TraceEvent, TrialRecord } from './types.js';
import { runConfigFor, runSession, type SessionRun } from './agents/run-session.js';
import {
  DirectRetriever,
  QueryAgentRetriever,
  RerankRetriever,
  type RetrieverDeps,
} from './agents/retrievers.js';
import type { Reranker } from './index/rerank.js';
import { WorkerSession } from './agents/session-worker.js';

export interface TrialInput {
  task: Task;
  tools: ToolDef[];
  genVersion: string;
  N: number;
  k: number;
  mode: Mode;
  backend: Backend;
  model: string;
  /** query agent model (query_agent mode); defaults to `model` */
  qaModel?: string;
  /** required for mode=rerank; shared across trials (loading the model is the slow part) */
  reranker?: Reranker;
  seed: number;
  repeat: number;
  runId: string;
  index: ToolIndex;
  embedder: Embedder;
  /** required for backend=claude-code */
  bridge?: Bridge;
  onEvent?: (e: TraceEvent) => void;
}

/** Look-alikes of the targets inside this catalog (same resource + action), max over targets. */
export function countConfusers(
  targets: ToolDef[],
  tools: ToolDef[],
  cat: Catalog,
): TrialRecord['confusers'] {
  const pinned = new Set(cat.pinned);
  const inCatalog = (t: ToolDef) => pinned.has(t.tool_id) || t.rank < cat.N - cat.pinned.length;
  let same_action = 0,
    same_vendor = 0;
  for (const target of targets) {
    const vendor = vendorOf(target.app);
    let a = 0,
      v = 0;
    for (const t of tools)
      if (
        t.tool_id !== target.tool_id &&
        t.resource === target.resource &&
        t.action === target.action &&
        inCatalog(t)
      ) {
        a++;
        if (vendorOf(t.app) === vendor) v++;
      }
    same_action = Math.max(same_action, a);
    same_vendor = Math.max(same_vendor, v);
  }
  return { same_action, same_vendor };
}

/**
 * One complete trial:
 *   1. build the retriever for the mode (direct search, or a query-agent session per request)
 *   2. run the worker session on the backend until it finishes, gives up, or hits the step cap
 *   3. grade the trace and assemble the record that results.jsonl / report.html / Phoenix consume
 */
export async function runTrial(i: TrialInput): Promise<TrialRecord> {
  const qa_model = i.mode === 'query_agent' ? (i.qaModel ?? i.model) : null;
  if (i.mode === 'rerank' && !i.reranker) throw new Error('mode rerank needs a reranker');
  const reranker = i.mode === 'rerank' ? i.reranker!.name : null;
  const key = trialKey({
    run_id: i.runId,
    task_id: i.task.task_id,
    N: i.N,
    k: i.k,
    mode: i.mode,
    backend: i.backend,
    model: i.model,
    qa_model,
    seed: i.seed,
    repeat: i.repeat,
    reranker,
  });
  const started = new Date();
  const trace = new Trace(i.onEvent);
  const toolsById = new Map(i.tools.map((t) => [t.tool_id, t]));
  const deps: RetrieverDeps = { index: i.index, embedder: i.embedder, toolsById, trace };

  const catalog: Catalog = { N: i.N, pinned: i.task.target_tool_ids };
  const targets = i.task.target_tool_ids.map((id) => toolsById.get(id)!);
  // worker budgets are per part, so two-step tasks get twice the turns and searches
  const parts = i.task.expected_calls.length;

  // 1. retriever
  const workerRun = runConfigFor(
    i.backend,
    i.model,
    config.stepCap * parts,
    config.ccTimeoutMs * parts,
    i.bridge,
  );
  const qaRetriever = qa_model
    ? new QueryAgentRetriever(
        deps,
        runConfigFor(i.backend, qa_model, config.qaStepCap, config.ccTimeoutMs, i.bridge),
        config.qaMaxSearches,
      )
    : null;
  const retriever =
    qaRetriever ??
    (reranker
      ? new RerankRetriever(deps, i.reranker!, config.rerankDepth)
      : new DirectRetriever(deps));

  // 2. worker
  const executor = new MockExecutor(makeRng(`${i.seed}:${i.repeat}:${i.task.task_id}`));
  const worker = new WorkerSession(trace, workerRun.namePrefix, {
    retriever,
    executor,
    N: i.N,
    pinned: catalog.pinned,
    k: i.k,
    maxRequestTools: config.maxRequestTools * parts,
  });
  let run: SessionRun;
  let error: string | undefined;
  try {
    run = await runSession(worker, i.task.prompt, workerRun);
    if (run.status === 'error') error = run.error;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    run = { status: 'error', usage: { inputTokens: 0, outputTokens: 0 }, llmCalls: 0, costUsd: 0 };
  }

  // 3. grade + record
  const { metrics, failure_type } = grade(i.task, trace.events, run.status === 'step_limit');
  const allRuns = [run, ...(qaRetriever?.runs ?? [])];
  const sum = (f: (r: SessionRun) => number) => allRuns.reduce((a, r) => a + f(r), 0);
  const record: TrialRecord = {
    trial_key: key,
    run_id: i.runId,
    task_id: i.task.task_id,
    task: {
      prompt: i.task.prompt,
      target_tool_id: targets[0]!.tool_id,
      target_name: targets[0]!.name,
      target_tool_ids: targets.map((t) => t.tool_id),
      target_names: targets.map((t) => t.name),
      tags: i.task.tags,
    },
    N: i.N,
    k: i.k,
    mode: i.mode,
    backend: i.backend,
    model: run.cc?.model ?? i.model,
    qa_model: qaRetriever?.runs[0]?.cc?.model ?? qa_model,
    reranker,
    seed: i.seed,
    repeat: i.repeat,
    gen_version: i.genVersion,
    started_at: started.toISOString(),
    latency_ms: Date.now() - started.getTime(),
    usage: {
      input_tokens: sum((r) => r.usage.inputTokens),
      output_tokens: sum((r) => r.usage.outputTokens),
      llm_calls: run.llmCalls,
      query_agent_llm_calls: (qaRetriever?.runs ?? []).reduce((a, r) => a + r.llmCalls, 0),
    },
    cost_usd: sum((r) => r.costUsd),
    metrics,
    failure_type,
    confusers: countConfusers(targets, i.tools, catalog),
    ...(error ? { error } : {}),
    rate_limit:
      allRuns
        .map((r) => r.rateLimit ?? null)
        .filter(Boolean)
        .at(-1) ?? null,
    events: trace.events,
  };
  exportTrial(record); // no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set
  return record;
}

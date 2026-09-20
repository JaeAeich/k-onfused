/** Runtime configuration: environment variables plus the experiment's fixed knobs. */
import 'dotenv/config';

export const config = {
  qdrantUrl: process.env.QDRANT_URL ?? 'http://localhost:6333',
  openrouterKey: process.env.OPENROUTER_API_KEY,
  /** default backend: headless Claude Code on the user's subscription */
  backend: (process.env.BACKEND ?? 'claude-code') as 'claude-code' | 'openrouter',
  ccModel: process.env.CC_MODEL ?? 'sonnet',
  ccTimeoutMs: 240_000,
  workerModel: process.env.WORKER_MODEL ?? 'anthropic/claude-sonnet-4.5',
  embedModel: 'Xenova/bge-small-en-v1.5',
  embedDim: 384,
  embedTag: 'bge_small',
  /** OTLP/HTTP traces endpoint (e.g. Phoenix: http://localhost:6006/v1/traces); unset = no export */
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  dataDir: 'data',
  runsDir: 'runs',
  /** worker: max model turns per trial and max request_tools calls */
  stepCap: 8,
  maxRequestTools: 3,
  /** query agent: max model turns per request_tools call and max search_tools calls */
  qaStepCap: 6,
  qaMaxSearches: 4,
  /** rerank mode: vector-search candidates handed to the cross-encoder, and the default cross-encoder */
  rerankDepth: 50,
  reranker: 'minilm' as const,
  seeds: { gen: 42, task: 7, run: 1 },
};

export const collectionName = (genVersion: string): string =>
  `tools_${genVersion}_${config.embedTag}`;

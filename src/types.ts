export type JsonSchema = Record<string, unknown>;

export interface ToolDef {
  tool_id: string;
  name: string;
  description: string;
  input_schema: JsonSchema;
  category: string;
  app: string;
  app_display: string;
  resource: string;
  action: string;
  variation_id: string;
  /**
   * Position in the shuffled universe, 0-based over non-targets. Task targets get TARGET_RANK so they never
   * fall inside `rank < N`; a trial pins its own targets instead (see ToolIndex.search).
   */
  rank: number;
}

/** `ref: i` = must equal the id returned by a valid call to expected_calls[i] (chained steps). */
export type ArgConstraint =
  { eq: unknown } | { ieq: string } | { includes: unknown[] } | { ref: number };

/** Keys may be dotted paths into nested objects, e.g. "changes.title". */
export interface ExpectedCall {
  tool_id: string;
  args: Record<string, ArgConstraint>;
}

/**
 * One expected call per step, in order. multi_step tasks have two: a chain (create, then act on the created
 * item via a `ref` constraint) or cross_app (two independent jobs in apps of different categories).
 */
export interface Task {
  task_id: string;
  prompt: string;
  target_tool_ids: string[];
  expected_calls: ExpectedCall[];
  tags: { near_duplicate: boolean; cross_app: boolean; multi_step: boolean };
}

export type TaskKind = 'single' | 'chain' | 'cross_app';

export type Backend = 'claude-code' | 'openrouter';
/** direct: vector top-k · rerank: vector top-50 re-ordered by a local cross-encoder · query_agent: LLM librarian */
export type Mode = 'direct' | 'query_agent' | 'rerank';
/** Which LLM produced or was involved in an event. */
export type AgentName = 'worker' | 'query_agent';

export type FailureType =
  'retrieval_miss' | 'wrong_tool' | 'bad_args' | 'hallucinated_tool' | 'gave_up' | 'step_limit';

export interface RetrievalHit {
  tool_id: string;
  score: number;
}

export interface RetrievalResult {
  query: string;
  hits: RetrievalHit[];
  tools: ToolDef[];
  latency_ms: number;
  reranker?: { model: string; candidates: number; latency_ms: number };
}

/** The simulated catalog: N tools = the trial's own targets (`pinned`) + the lowest-ranked others. */
export interface Catalog {
  N: number;
  pinned: string[];
}

export interface Retriever {
  retrieve(query: string, opts: Catalog & { k: number }): Promise<RetrievalResult>;
}

/** Every trace event carries `ts` (epoch ms, set by Trace.push) so spans can be rebuilt after the fact. */
export type TraceEvent = TraceEventBody & { ts?: number };

export type TraceEventBody =
  /** one model turn */
  | {
      type: 'llm_call';
      step: number;
      agent: AgentName;
      model: string;
      input_tokens: number;
      /** approximate on the claude-code backend (streaming snapshot); trial totals are exact */
      output_tokens: number;
      latency_ms: number;
      finish_reason: string;
      text: string;
      n_tools: number;
    }
  /** one raw vector search (direct: 1 per request_tools; query_agent: 1 per search_tools) */
  | {
      type: 'search';
      step: number;
      agent: AgentName;
      query: string;
      filters: Record<string, string> | null;
      N: number;
      k: number;
      hits: RetrievalHit[];
      latency_ms: number;
    }
  /** what the worker actually got back from request_tools */
  | {
      type: 'retrieval';
      step: number;
      need: string;
      hits: RetrievalHit[];
      latency_ms: number;
      /** rerank mode: which cross-encoder, how many candidates it scored, its share of latency_ms */
      reranker?: { model: string; candidates: number; latency_ms: number };
    }
  | {
      type: 'tool_call';
      step: number;
      tool_name: string;
      /** null = the model called a tool that does not exist */
      tool_id: string | null;
      args: unknown;
      valid: boolean;
      response: unknown;
    }
  | { type: 'finish'; step: number; status: 'completed' | 'cannot_complete'; summary: string }
  | { type: 'note'; step: number; text: string };

export interface TrialMetrics {
  /** target appeared in at least one raw search (upper bound on what any retriever could deliver) */
  search_hit: boolean;
  /** target was among the tools delivered to the worker */
  retrieval_hit: boolean;
  selection_correct: boolean;
  args_correct: boolean;
  success: boolean;
  /** domain calls to tools other than the target */
  extra_calls: number;
  /** calls to tool names that did not exist */
  hallucinated_calls: number;
  steps: number;
  /** expected calls satisfied / expected calls (absent on records before M5) */
  parts_done?: number;
  parts_total?: number;
}

export interface TrialRecord {
  trial_key: string;
  run_id: string;
  task_id: string;
  /** copied from the task so the record stays readable after tasks are regenerated */
  task: {
    prompt: string;
    /** first target (kept for older readers); all targets below */
    target_tool_id: string;
    target_name: string;
    target_tool_ids?: string[];
    target_names?: string[];
    tags: Task['tags'];
  };
  N: number;
  k: number;
  mode: Mode;
  backend: Backend;
  model: string;
  /** query agent model (query_agent mode only) */
  qa_model: string | null;
  /** local cross-encoder (rerank mode only) */
  reranker?: string | null;
  seed: number;
  repeat: number;
  gen_version: string;
  started_at: string;
  latency_ms: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    llm_calls: number;
    query_agent_llm_calls: number;
  };
  /** Claude Code's estimate on the subscription backend (nothing billed); real on OpenRouter */
  cost_usd: number;
  metrics: TrialMetrics;
  failure_type: FailureType | null;
  /**
   * Look-alikes in this trial's catalog: other tools with the same resource + action as a target
   * (max over targets); `same_vendor` counts only the target's vendor (other editions / id forms).
   */
  confusers?: { same_action: number; same_vendor: number };
  error?: string;
  /** subscription window state reported by Claude Code during this trial (claude-code backend) */
  rate_limit?: RateLimitState | null;
  events: TraceEvent[];
}

export interface RateLimitState {
  status: string;
  five_hour?: { utilization: number; resets_at: number };
  seven_day?: { utilization: number; resets_at: number };
}

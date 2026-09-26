# ToolScale

How well does an LLM agent find and correctly call the right tool as the tool catalog grows (N = 100
… 200k) and as the number of retrieved tools (k) changes? Everything is mocked; no real APIs.

## Setup

```sh
npm install
docker compose up -d          # Qdrant on :6333
cp .env.example .env          # defaults use your Claude Code login; no API key needed
```

The worker runs on headless Claude Code (`claude -p`) with your subscription. Set
`BACKEND=openrouter` and `OPENROUTER_API_KEY` to run any OpenRouter model through the AI SDK
instead.

## Commands

```sh
npm run gen                                     # 1,000 tools + 10 tasks → data/*.jsonl (deterministic)
npm run gen -- --count 200000 --tasks 30 --multi 10   # current data: 30 single-step + 10 two-step tasks
npm run index -- --check                        # embed + upsert into Qdrant, then a retrieval sanity check
npm run trial -- --task t001 --N 1000 --k 10    # one trial, live trace, PASS/FAIL + failure type
npm run trial -- --task t004 --k 3 --mode query_agent --results results.jsonl
npm run experiment -- --N 100,1000,10000,100000,200000 --k 3,5,10,20,50,100 --mode direct,query_agent --repeats 3
npm run report                                  # results.jsonl → report.html (charts + trial stories)
npm run results -- --run-id main1               # shareable write-up → results/main1/ (see below)
npm run rerank-eval -- --run-id main1           # offline: replay recorded searches through local re-rankers
npm run export                                  # re-send results.jsonl as OpenTelemetry traces to Phoenix
npm test && npm run check                       # unit tests; typecheck + eslint + prettier
```

### Write-up for one run

`npm run results -- --run-id <id>` writes `results/<id>/`: `README.md` (setup, charts, tables with
95% CIs, paired flip tests, every task × setting, every failure with a one-line reason, exact
reproduce commands with data checksums), SVG figures, `trials.csv` / `cells.csv` / `tasks.csv`,
`manifest.json`, and a `report.html` for that run only. Hand-written conclusions go in
`results/<id>/FINDINGS.md`; re-running the command pulls them into the top of the README.

### Traces in Phoenix

`docker compose up -d phoenix` starts Arize Phoenix on <http://localhost:6006>. Set
`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006/v1/traces` in `.env` and every trial is exported
as one trace: `trial` → `worker turn n` → `request_tools` (→ query-agent turns and searches) / tool
calls / `finish` → `grade`. Attributes use `gen_ai.*` where the semantic conventions have a name and
`eval.*` for ours. Spans are rebuilt from the recorded trace events (`src/telemetry.ts`), so
`npm run export` can replay older results into Phoenix at any time.

Retrieval modes: `direct` (vector top-k), `rerank` (vector top-50 re-ordered by a local
cross-encoder, `--reranker minilm|bge-base|bge-m3`, no LLM), `query_agent` (an LLM librarian runs
filtered searches).

Trial flags: `--N` catalog size (the trial's own targets plus the `N - targets` lowest-ranked other
tools; other tasks' targets are never in the catalog), `--k` tools per search,
`--mode direct|rerank|query_agent`, `--model haiku|sonnet|opus`, `--qa-model` for the librarian,
`--results <file>` to append the record to a JSONL file.

### The sweep runner

`npm run experiment` expands N × k × mode × task × repeat, skips trials whose key is already in
`results.jsonl` (so a crashed or interrupted run just resumes), runs them with `--concurrency`
workers, and appends each record as it finishes. On the Claude Code backend it reads the
subscription window state that Claude Code reports and pauses when the 5-hour window passes
`--five-hour-max` (default 92%) or the status is not `allowed`; rate-limit errors are retried after
a pause. `--dry-run` prints the plan, `--tasks first:5` limits tasks, `--run-id` names the run (part
of the resume key).

Scale: `npm run gen -- --count 200000 --tasks 30 --multi 10` then `npm run index` (≈7 min on a
laptop; embeddings are cached in `data/`; after a task change `npm run index -- --ranks-only`
rewrites ranks in ≈4 min). N is always a filter at query time.

## Tasks

- **single** (t001–t030): one target tool; the prompt names the app and gives every required
  argument in the form only that tool accepts (id vs URL vs key), worded so it shares no 3-gram with
  the tool description.
- **chain** (multi_step): create something, then act on it by id (`"…, then kill it."`). The second
  call's id must equal the id the mock returned for the first (`{ ref: 0 }` constraint), so the
  worker has to read tool output. Resources also addressable by name/email are excluded (that call
  would be equally correct).
- **cross_app** (multi_step, cross_app): two independent jobs in apps of different categories.

Multi-step trials get per-part budgets (2× turns and searches), and the grader requires every part;
the failure type describes the first part not done, and `parts_done/parts_total` gives partial
credit. Each record also carries `confusers`: how many tools in _that_ catalog share the target's
resource + action (and how many of those are from the same vendor). The report breaks success down
by task kind, look-alike count, and task.

## How a trial works

```text
task prompt ─▶ WorkerSession ──request_tools(need)──▶ Retriever ──▶ Qdrant (own targets + rank < N-t, top-k)
                    │                                    │
                    │            direct: embed `need`     │  query_agent: a second LLM session
                    │            and search once          │  runs search_tools (filters, retries)
                    │                                    │  and picks ≤ k tools to hand back
                    ├──<tool>(args)──▶ MockExecutor (ajv-validated, fake success)
                    └──finish(status)
                                  ▼
                       grade(trace) ─▶ TrialRecord ─▶ runs/<key>.json, results.jsonl, report.html
```

- **Sessions** (`src/agents/session*.ts`) own an agent's tool surface and state. They don't know
  which LLM drives them.
- **Backends** (`src/agents/run-session.ts`) drive a session: headless Claude Code (tools served
  through a stdio MCP shim → in-process HTTP bridge, `src/cc/`) or an AI SDK loop
  (`src/agents/llm.ts`).
- **Grader** (`src/grade.ts`) reads the trace, per part: `search_hit` (target in any raw search),
  `retrieval_hit` (target delivered to the worker), selection, args, and one failure type:
  `retrieval_miss | wrong_tool | bad_args | hallucinated_tool | gave_up | step_limit`.
- **Report** (`src/report/`) aggregates cells with Wilson 95% intervals (`stats.ts`, unit-tested and
  also inlined into the page) and renders charts, a cell table, and a clickable trial story.
  `report.html?trial=<key>` deep-links a story.

## Reading guide

Read in this order; each file starts with a comment saying what it owns.

| #   | File                                                               | What it answers                                                                       |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 1   | `src/types.ts`                                                     | The vocabulary: ToolDef, Task, TraceEvent, TrialRecord, failure types                 |
| 2   | `src/gen/vocab.ts` → `tools.ts` → `tasks.ts`                       | How 200k plausible tools and unambiguous tasks come from a seed                       |
| 3   | `src/index/embed.ts`, `qdrant.ts`                                  | Embedding with a disk cache; `rank` + pinned targets as the catalog-size dial         |
| 4   | `src/agents/session.ts` → `session-worker.ts` → `session-query.ts` | What each agent can do; state per run; no LLM inside                                  |
| 5   | `src/agents/run-session.ts`                                        | How a session is driven by Claude Code (via `src/cc/`) or the AI SDK                  |
| 6   | `src/cc/headless.ts`, `bridge.ts`, `shim.ts`                       | The subscription path: `claude -p`, stream parsing, MCP tools served from the harness |
| 7   | `src/agents/retrievers.ts`                                         | direct vs query_agent retrieval behind one interface                                  |
| 8   | `src/exec/mock.ts`, `src/grade.ts`                                 | Schema-validated fake execution; metrics and failure precedence                       |
| 9   | `src/trial.ts` → `src/experiment.ts`                               | One trial; the sweep with resume, concurrency, and window pacing                      |
| 10  | `src/report/stats.ts`, `render.ts`, `html.ts`; `src/telemetry.ts`  | Aggregation with confidence intervals, the page, Phoenix spans                        |

`test/` mirrors this: generator invariants, grader precedence, stream parsing, sessions with fakes,
stats, pacer, and the span tree.

## Layout

```text
src/gen/       vocab + deterministic tool/task generator (prefix universe, seeded)
src/index/     transformers.js embedder (bge-small, disk cache) + Qdrant index with payload filters
src/exec/      mock executor
src/cc/        headless Claude Code runner, HTTP bridge, MCP shim
src/agents/    sessions (worker, query agent), retrievers, backend-agnostic session runner
src/trial.ts   runTrial(): one complete trial → TrialRecord
src/results.ts results.jsonl append/read + trial keys (resume)
src/report/    stats + browser renderer + HTML assembler
src/telemetry.ts  TrialRecord → OpenTelemetry span tree → OTLP (Phoenix)
src/cli/       gen | index | trial | experiment | report | export
```

## Caveats

- On the Claude Code backend the numbers measure "Claude Code + our tools" (its loop, its turn
  budget). Curves across N and k are comparable; absolute rates carry that confound.
- Per-turn output tokens from the stream are approximate; trial totals are exact. `cost_usd` is
  Claude Code's estimate and nothing is billed on a subscription.
- Max plans have a 5-hour window and a weekly cap; the trace records utilization per trial.

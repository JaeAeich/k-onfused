/**
 * Results write-up for one run: a markdown document someone else can read, check, and reproduce, plus
 * static SVG figures and flat CSVs of every trial. Every figure has a table with the same numbers.
 * Pure: takes records + metadata, returns { relative path → file content }; the CLI writes them.
 */
import type { FailureType, Task, TraceEvent, TrialRecord } from '../types.js';
import {
  CONFUSER_BUCKETS,
  FAILURE_TYPES,
  aggregate,
  breakdown,
  confuserBucket,
  targetsOf,
  taskKind,
  uniqueSorted,
  type BreakdownRow,
  type Cell,
} from './stats.js';
import { lineChartSvg, stackedBarsSvg } from './svg.js';

export interface Manifest {
  run_id: string;
  generated_at: string;
  command: string;
  trials: number;
  errors: number;
  first_trial_at: string;
  last_trial_at: string;
  backend: string[];
  models: string[];
  qa_models: string[];
  modes: string[];
  N: number[];
  k: number[];
  tasks: string[];
  repeats: number;
  seed: number[];
  gen_version: string[];
  gen_command: string;
  data: { tools_file: string; tools_sha256: string; tasks_file: string; tasks_sha256: string };
  knobs: Record<string, unknown>;
  env: Record<string, string>;
}

export interface WriteupInput {
  records: TrialRecord[];
  tasks: Task[];
  /** tool_id → name, for every tool referenced by the records */
  names: Map<string, string>;
  manifest: Manifest;
  workerPrompt: string;
  /** hand-written FINDINGS.md from the run folder, if any */
  findings: string | null;
}

const fmtN = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(n));
const pct = (p: number) => (Number.isNaN(p) ? '–' : `${Math.round(p * 100)}%`);
const ci = (r: { p: number; lo: number; hi: number }) =>
  Number.isNaN(r.p) ? '–' : `${pct(r.p)} (${pct(r.lo)}–${pct(r.hi)})`;
const cellText = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const table = (head: string[], rows: (string | number)[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map((c) => cellText(String(c))).join(' | ')} |`),
  ].join('\n');
const bare = (name: string) => name.replace(/^mcp__ts__/, '');
const short = (v: unknown, n = 90) => {
  const s = JSON.stringify(v) ?? '';
  return s.length > n ? s.slice(0, n) + '…' : s;
};

const CODE: Record<FailureType, string> = {
  retrieval_miss: 'RM',
  wrong_tool: 'WT',
  bad_args: 'BA',
  hallucinated_tool: 'HT',
  gave_up: 'GU',
  step_limit: 'SL',
};

/** Two-sided exact McNemar test on the discordant pairs (b, c). */
export function exactMcNemar(b: number, c: number): number {
  const n = b + c;
  if (!n) return 1;
  let term = Math.pow(0.5, n),
    s = 0;
  for (let i = 0; i <= Math.min(b, c); i++) {
    s += term;
    term = (term * (n - i)) / (i + 1);
  }
  return Math.min(1, 2 * s);
}

type Call = Extract<TraceEvent, { type: 'tool_call' }>;

/** One line on why a trial failed, read off its trace. */
export function whatHappened(r: TrialRecord, names: Map<string, string>): string {
  const nm = (id: string) => names.get(id) ?? id;
  const targets = targetsOf(r);
  const calls = r.events.filter((e): e is Call => e.type === 'tool_call');
  const delivered = new Set(
    r.events.flatMap((e) => (e.type === 'retrieval' ? e.hits.map((h) => h.tool_id) : [])),
  );
  const needs = r.events.flatMap((e) => (e.type === 'retrieval' ? [`"${e.need}"`] : []));
  const uniq = (xs: string[]) => [...new Set(xs)].join(', ');
  const parts =
    (r.metrics.parts_total ?? 1) > 1
      ? ` [${r.metrics.parts_done}/${r.metrics.parts_total} parts done]`
      : '';
  const base = (() => {
    switch (r.failure_type) {
      case 'retrieval_miss':
        return (
          `never received ${uniq(targets.filter((t) => !delivered.has(t)).map(nm))};` +
          ` asked for ${needs.join(', ') || '(nothing)'}`
        );
      case 'wrong_tool': {
        const called = calls.filter((c) => c.tool_id && !targets.includes(c.tool_id));
        const missed = targets.filter((t) => !calls.some((c) => c.tool_id === t));
        return `called ${uniq(called.map((c) => bare(c.tool_name)))} instead of ${uniq(missed.map(nm))}`;
      }
      case 'bad_args': {
        const c = calls.filter((x) => x.tool_id && targets.includes(x.tool_id)).at(-1);
        return c
          ? `called ${bare(c.tool_name)} with ${short(c.args)}${c.valid ? '' : ' (schema-invalid)'}`
          : '';
      }
      case 'hallucinated_tool':
        return `called nonexistent ${uniq(calls.filter((c) => c.tool_id === null).map((c) => bare(c.tool_name)))}`;
      case 'gave_up': {
        const f = r.events.find((e) => e.type === 'finish');
        return f && f.type === 'finish'
          ? `finish(${f.status}): ${f.summary.slice(0, 120)}`
          : 'stopped without calling finish';
      }
      case 'step_limit':
        return `hit the turn cap after ${r.metrics.steps} steps`;
      default:
        return '';
    }
  })();
  return (r.error ? `error: ${r.error.slice(0, 100)}; ` : '') + base + parts;
}

interface Group {
  label: string;
  mode: string;
  model: string;
  rows: TrialRecord[];
  cells: Cell[];
}

function groupsOf(records: TrialRecord[]): Group[] {
  const keys = uniqueSorted(records.map((r) => `${r.mode}|${r.model}|${r.qa_model ?? ''}`));
  const multi = keys.length > 1;
  return keys.map((key) => {
    const [mode, model, qa] = key.split('|') as [string, string, string];
    const rows = records.filter((r) => `${r.mode}|${r.model}|${r.qa_model ?? ''}` === key);
    return {
      label: multi ? `${mode} · ${model}${qa && qa !== model ? ` / qa ${qa}` : ''}` : '',
      mode,
      model,
      rows,
      cells: aggregate(rows),
    };
  });
}

/** Flip counts between two sets of trials paired by task + repeat. */
function flips(a: TrialRecord[], b: TrialRecord[]) {
  const key = (r: TrialRecord) => `${r.task_id}|${r.repeat}`;
  const bm = new Map(b.map((r) => [key(r), r.metrics.success]));
  let both = 0,
    onlyA = 0,
    onlyB = 0,
    neither = 0;
  for (const r of a) {
    const sb = bm.get(key(r));
    if (sb === undefined) continue;
    const sa = r.metrics.success;
    if (sa && sb) both++;
    else if (sa) onlyA++;
    else if (sb) onlyB++;
    else neither++;
  }
  return {
    pairs: both + onlyA + onlyB + neither,
    both,
    onlyA,
    onlyB,
    neither,
    p: exactMcNemar(onlyA, onlyB),
  };
}

function pairedSection(g: Group): string {
  const Ns = uniqueSorted(g.rows.map((r) => r.N));
  const ks = uniqueSorted(g.rows.map((r) => r.k));
  const out: string[][] = [];
  const pair = (
    fixed: string,
    a: TrialRecord[],
    b: TrialRecord[],
    labelA: string,
    labelB: string,
  ) => {
    const f = flips(a, b);
    out.push(
      [
        fixed,
        `${labelA} → ${labelB}`,
        f.pairs,
        f.both,
        f.onlyA,
        f.onlyB,
        f.neither,
        f.p.toFixed(3),
      ].map(String),
    );
  };
  const at = (N: number, k: number) => g.rows.filter((r) => r.N === N && r.k === k);
  if (Ns.length > 1)
    for (const k of ks)
      pair(
        `k=${k}`,
        at(Ns[0]!, k),
        at(Ns.at(-1)!, k),
        `N=${fmtN(Ns[0]!)}`,
        `N=${fmtN(Ns.at(-1)!)}`,
      );
  if (ks.length > 1)
    for (const N of Ns)
      pair(`N=${fmtN(N)}`, at(N, ks[0]!), at(N, ks.at(-1)!), `k=${ks[0]}`, `k=${ks.at(-1)}`);
  if (!out.length) return '';
  return [
    'Same task, two settings: does it pass in one and fail in the other? Only the tasks that flip carry',
    'information; the exact McNemar test asks whether the flips lean one way more than chance would.',
    '',
    table(
      [
        'held fixed',
        'comparison',
        'pairs',
        'pass both',
        'pass only first',
        'pass only second',
        'fail both',
        'p (exact McNemar)',
      ],
      out,
    ),
  ].join('\n');
}

function breakdownTable(rows: BreakdownRow[], first: string): string {
  return table(
    [first, 'n', 'success (95% CI)', 'recall@k', 'select | hit', 'parts done'],
    rows.map((b) => [
      b.key,
      b.n,
      ci(b.success),
      pct(b.retrieval_hit.p),
      pct(b.selection_given_hit.p),
      pct(b.parts),
    ]),
  );
}

const MODE_ORDER = ['direct', 'rerank', 'query_agent'];
const MODE_SHORT: Record<string, string> = {
  direct: 'direct',
  rerank: 're-ranker',
  query_agent: 'librarian',
};
const MODE_TEXT: Record<string, string> = {
  rerank:
    'In `rerank` mode the vector search returns its top 50 and a small local cross-encoder' +
    ' (one forward pass, no LLM) re-orders them; the worker gets the top k.',
  query_agent:
    "In `query_agent` mode a second model (the librarian) turns the agent's request into one or more" +
    ' filtered searches (by app, resource, action) and hands back ≤ k tools.',
};

/** Every retrieval mode vs direct on the settings both ran (same model), incl. what each costs. */
function modeComparison(records: TrialRecord[], files: Record<string, string>): string {
  const modes = uniqueSorted(records.map((r) => r.mode)).sort(
    (a, b) => MODE_ORDER.indexOf(a) - MODE_ORDER.indexOf(b),
  );
  const others = modes.filter((m) => m !== 'direct');
  if (!modes.includes('direct') || !others.length) return '';
  type Setting = { model: string; N: number; k: number };
  const at = (mode: string, s: Setting) =>
    records.filter((r) => r.mode === mode && r.model === s.model && r.N === s.N && r.k === s.k);
  const settings: Setting[] = uniqueSorted(records.map((r) => `${r.model}|${r.N}|${r.k}`))
    .map((x) => {
      const [model, N, k] = x.split('|');
      return { model: model!, N: Number(N), k: Number(k) };
    })
    .filter((s) => at('direct', s).length && others.some((m) => at(m, s).length))
    .sort((a, b) => a.N - b.N || a.k - b.k);
  if (!settings.length) return '';
  const label = (s: Setting) => `N=${fmtN(s.N)} · k=${s.k}`;
  const oneN = uniqueSorted(settings.map((s) => s.N)).length === 1;
  const xOf = (s: Setting) => (oneN ? `k=${s.k}` : label(s));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const rerankMs = (rs: TrialRecord[]) =>
    mean(
      rs.flatMap((r) =>
        r.events.flatMap((e) =>
          e.type === 'retrieval' && e.reranker ? [e.reranker.latency_ms] : [],
        ),
      ),
    );
  const rerankers = uniqueSorted(records.map((r) => r.reranker).filter((x): x is string => !!x));

  files['figures/modes.svg'] = lineChartSvg({
    title: 'Retrieval methods compared: success rate',
    subtitle: 'same tasks, same catalogs · whiskers = 95% CI',
    xLabel: oneN ? `tools per search · N=${fmtN(settings[0]!.N)}` : 'setting',
    xs: settings.map(xOf),
    series: modes.map((mode) => ({
      name: MODE_SHORT[mode] ?? mode,
      slot: Math.max(0, MODE_ORDER.indexOf(mode)),
      points: settings.flatMap((s) => {
        const rs = at(mode, s);
        if (!rs.length) return [];
        const c = aggregate(rs)[0]!;
        return [{ x: xOf(s), y: c.success.p, lo: c.success.lo, hi: c.success.hi, n: c.n }];
      }),
    })),
  });

  const rows = settings.flatMap((s) =>
    modes.flatMap((mode) => {
      const rs = at(mode, s);
      if (!rs.length) return [];
      const c = aggregate(rs)[0]!;
      const ms = rerankMs(rs);
      return [
        [
          label(s),
          MODE_SHORT[mode] ?? mode,
          c.n,
          ci(c.success),
          pct(c.retrieval_hit.p),
          pct(c.selection_given_hit.p),
          c.mean_llm_calls.toFixed(1),
          `${(c.mean_input_tokens / 1000).toFixed(0)}k`,
          (c.mean_latency_ms / 1000).toFixed(0),
          Number.isNaN(ms) ? '–' : `${Math.round(ms)}`,
          `$${mean(rs.map((r) => r.cost_usd)).toFixed(3)}`,
        ],
      ];
    }),
  );
  const paired = settings.flatMap((s) =>
    others.flatMap((mode) => {
      if (!at(mode, s).length) return [];
      const f = flips(at('direct', s), at(mode, s));
      return [
        [
          label(s),
          MODE_SHORT[mode] ?? mode,
          f.pairs,
          f.both,
          f.onlyA,
          f.onlyB,
          f.neither,
          f.p.toFixed(3),
        ],
      ];
    }),
  );
  return [
    '## Retrieval methods compared',
    '',
    "`direct`: the agent's request is embedded and the top-k tools from the vector search are handed over.",
    ...others.map((m) => MODE_TEXT[m] ?? ''),
    rerankers.length ? `Cross-encoder used: ${rerankers.join(', ')}.` : '',
    'Same tasks, same catalogs.',
    '',
    '![Retrieval methods](figures/modes.svg)',
    '',
    table(
      [
        'setting',
        'method',
        'n',
        'success (95% CI)',
        'recall@k',
        'select | hit',
        'LLM calls / trial',
        'input tokens / trial',
        'seconds / trial',
        're-rank ms / search',
        'API-price estimate / trial',
      ],
      rows,
    ),
    '',
    'API-price estimate = what Claude Code reports the trial would cost at API prices (nothing is billed on',
    'a subscription); the re-ranker runs locally and costs nothing.',
    '',
    'Task by task, each method against direct on the same task:',
    '',
    table(
      [
        'setting',
        'method',
        'pairs',
        'pass both',
        'pass only direct',
        'pass only method',
        'fail both',
        'p (exact McNemar)',
      ],
      paired,
    ),
  ].join('\n');
}

const minute = (iso: string) => iso.slice(0, 16).replace('T', ' ');

export function buildWriteup(i: WriteupInput): Record<string, string> {
  const m = i.manifest;
  const files: Record<string, string> = {};
  const md: string[] = [];
  const groups = groupsOf(i.records);
  const kinds = breakdown(i.records, taskKind, ['single', 'chain', 'cross_app']);
  const tasksUsed = i.tasks.filter((t) => m.tasks.includes(t.task_id));
  const kindOf = (t: Task) =>
    t.tags.multi_step ? (t.tags.cross_app ? 'cross_app' : 'chain') : 'single';
  const nKind = (k: string) => tasksUsed.filter((t) => kindOf(t) === k).length;
  const tokens = i.records.reduce((a, r) => a + r.usage.input_tokens + r.usage.output_tokens, 0);

  md.push(
    `# ToolScale results · run \`${m.run_id}\``,
    '',
    '**Question.** When an agent has to find its tools by searching a catalog, how does its success change as',
    'the catalog grows (N) and as each search returns more or fewer tools (k)?',
    '',
    `**Setup.** ${m.tasks.length} tasks (${nKind('single')} single-step,` +
      ` ${nKind('chain')} chain, ${nKind('cross_app')} cross-app),` +
      ` ${m.repeats} repeat${m.repeats > 1 ? 's' : ''}: ${m.modes
        .map((mode) => {
          const rs = i.records.filter((r) => r.mode === mode);
          return `${mode} retrieval at N ${uniqueSorted(rs.map((r) => r.N))
            .map(fmtN)
            .join(
              ' / ',
            )} × k ${uniqueSorted(rs.map((r) => r.k)).join(' / ')} (${rs.length} trials)`;
        })
        .join('; ')}. **${m.trials} trials** on ${m.models.join(', ')}` +
      ` (${m.backend.join(', ')} backend)` +
      `, ${minute(m.first_trial_at)} → ${minute(m.last_trial_at)} UTC.` +
      ` ${m.errors} trial${m.errors === 1 ? '' : 's'}` +
      ` ended in a harness/model error (counted as failures).` +
      ` ${(tokens / 1e6).toFixed(2)}M tokens total.`,
    '',
    `All tools and tasks are synthetic and deterministic (generator \`${m.gen_version.join(', ')}\`);` +
      ` tool calls hit a schema-checking mock.` +
      ` A trial passes only if every expected call is made with the right arguments.` +
      ` Numbers in parentheses are 95% Wilson intervals:` +
      ` with ~${Math.round(
        i.records.length /
          Math.max(
            1,
            groups.reduce((a, g) => a + g.cells.length, 0),
          ),
      )} trials per cell they are wide,` +
      ` so read differences inside overlapping intervals as "not shown", not as "no effect".`,
    '',
    '## Findings',
    '',
    i.findings?.trim() ||
      '_Not written yet: add `FINDINGS.md` to this folder and re-run `npm run results`._',
    '',
  );

  for (const g of groups) {
    const suffix = g.label ? ` · ${g.label}` : '';
    const slug = `${g.mode}-${g.model}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const Ns = uniqueSorted(g.cells.map((c) => c.N));
    const ks = uniqueSorted(g.cells.map((c) => c.k));
    const series = (pick: (c: Cell) => Cell['success']) =>
      ks.map((k, si) => ({
        name: `k=${k}`,
        slot: si,
        points: g.cells
          .filter((c) => c.k === k)
          .map((c) => ({
            x: fmtN(c.N),
            y: pick(c).p,
            lo: pick(c).lo,
            hi: pick(c).hi,
            n: pick(c).n,
          })),
      }));
    const byNk = (pick: (c: Cell) => Cell['success']) =>
      table(
        ['N', ...ks.map((k) => `k=${k}`)],
        Ns.map((N) => [
          fmtN(N),
          ...ks.map((k) => {
            const c = g.cells.find((x) => x.N === N && x.k === k);
            return c ? `${ci(pick(c))} n=${pick(c).n}` : '–';
          }),
        ]),
      );

    // a curve needs ≥ 2 catalog sizes (a mode run at one N is covered by the mode comparison)
    const curve = Ns.length > 1;
    if (curve)
      files[`figures/success-${slug}.svg`] = lineChartSvg({
        title: `Success rate vs catalog size${suffix}`,
        subtitle: 'one line per k (tools returned per search) · whiskers = 95% CI',
        xLabel: 'catalog size N',
        xs: Ns.map(fmtN),
        series: series((c) => c.success),
      });
    if (curve)
      files[`figures/recall-${slug}.svg`] = lineChartSvg({
        title: `Recall@k: target delivered to the agent${suffix}`,
        subtitle: 'did any search hand the agent every target tool? · whiskers = 95% CI',
        xLabel: 'catalog size N',
        xs: Ns.map(fmtN),
        series: series((c) => c.retrieval_hit),
      });
    const outcomeCats = [
      { name: 'pass', slot: 'neutral' as const },
      ...FAILURE_TYPES.map((f, idx) => ({ name: f.replace('_', ' '), slot: idx })),
    ];
    const outcomeRows = g.cells.map((c) => ({
      label: `N=${fmtN(c.N)} · k=${c.k}`,
      counts: [Math.round(c.success.p * c.n), ...FAILURE_TYPES.map((f) => c.failures[f])],
    }));
    files[`figures/outcomes-${slug}.svg`] = stackedBarsSvg({
      title: `How trials ended${suffix}`,
      subtitle: 'failure type = first thing that went wrong (see definitions below)',
      categories: outcomeCats,
      rows: outcomeRows,
    });

    md.push(
      `## Success vs catalog size${suffix}`,
      '',
      curve
        ? `![Success rate vs N](figures/success-${slug}.svg)`
        : '_One catalog size only: no curve._',
      '',
      byNk((c) => c.success),
      '',
      `## Retrieval: did the agent even get the right tool?${suffix}`,
      '',
      'If the target never reaches the agent, no model can succeed; this separates search failures from',
      'choice failures.',
      '',
      curve ? `![Recall@k vs N](figures/recall-${slug}.svg)` : '',
      '',
      byNk((c) => c.retrieval_hit),
      '',
      'Given the target *was* delivered, how often did the agent call it?',
      '',
      byNk((c) => c.selection_given_hit),
      '',
      `## How trials ended${suffix}`,
      '',
      `![Outcome mix](figures/outcomes-${slug}.svg)`,
      '',
      table(
        ['cell', 'n', 'pass', ...FAILURE_TYPES],
        g.cells.map((c) => [
          `N=${fmtN(c.N)} · k=${c.k}`,
          c.n,
          Math.round(c.success.p * c.n),
          ...FAILURE_TYPES.map((f) => c.failures[f]),
        ]),
      ),
      '',
      `## Paired comparisons${suffix}`,
      '',
      pairedSection(g),
      '',
    );
  }

  md.push(modeComparison(i.records, files), '');

  md.push(
    '## By task kind',
    '',
    breakdownTable(kinds, 'kind'),
    '',
    '## By look-alikes in the catalog',
    '',
    "Look-alikes = other tools in *that trial's* catalog with the same resource + action as a target",
    '(e.g. every "delete job posting" tool). This grows with N, so it overlaps with the N effect.',
    '',
    breakdownTable(
      breakdown(
        i.records,
        (r) => (r.confusers ? confuserBucket(r.confusers.same_action) : null),
        CONFUSER_BUCKETS,
      ),
      'look-alikes',
    ),
    '',
    'Same, counting only the target\'s own vendor (other editions like "Slack Enterprise", other id forms):',
    '',
    breakdownTable(
      breakdown(
        i.records,
        (r) => (r.confusers ? confuserBucket(r.confusers.same_vendor) : null),
        CONFUSER_BUCKETS,
      ),
      'same-vendor',
    ),
    '',
  );

  // per-task grid
  md.push(
    '## Every task × every setting',
    '',
    '✓ = pass; otherwise the failure: RM retrieval miss, WT wrong tool, BA bad args, HT hallucinated tool,',
    'GU gave up, SL step limit, ERR error. A row that fails everywhere is worth checking for a task-wording',
    'problem before blaming the model.',
    '',
  );
  for (const g of groups) {
    const cols = uniqueSorted(g.rows.map((r) => r.N)).flatMap((N) =>
      uniqueSorted(g.rows.filter((r) => r.N === N).map((r) => r.k)).map((k) => ({ N, k })),
    );
    const taskIds = uniqueSorted(g.rows.map((r) => r.task_id));
    if (g.label) md.push(`**${g.label}**`, '');
    md.push(
      table(
        ['task', 'kind', ...cols.map((c) => `${fmtN(c.N)} / k${c.k}`), 'pass'],
        taskIds.map((id) => {
          const rs = g.rows.filter((r) => r.task_id === id);
          const cell = (N: number, k: number) => {
            const xs = rs.filter((r) => r.N === N && r.k === k);
            if (!xs.length) return '';
            if (xs.length > 1) return `${xs.filter((r) => r.metrics.success).length}/${xs.length}`;
            const r = xs[0]!;
            return r.metrics.success ? '✓' : r.failure_type ? CODE[r.failure_type] : 'ERR';
          };
          return [
            id,
            taskKind(rs[0]!),
            ...cols.map((c) => cell(c.N, c.k)),
            `${rs.filter((r) => r.metrics.success).length}/${rs.length}`,
          ];
        }),
      ),
      '',
    );
  }

  // failures
  const failed = i.records.filter((r) => !r.metrics.success);
  md.push(
    '## Every failed trial',
    '',
    `Open \`report.html\` in this folder (links below) for the full step-by-step story of each trial.`,
    '',
    table(
      ['task', 'mode', 'N', 'k', 'outcome', 'what happened', 'story'],
      failed.map((r) => [
        r.task_id,
        r.mode,
        fmtN(r.N),
        r.k,
        r.failure_type ?? 'error',
        whatHappened(r, i.names),
        `[${r.trial_key}](report.html#t-${r.trial_key})`,
      ]),
    ),
    '',
  );

  // tasks
  md.push(
    '## Tasks used',
    '',
    table(
      ['task', 'kind', 'prompt', 'expected call(s)'],
      tasksUsed.map((t) => [
        t.task_id,
        kindOf(t),
        t.prompt,
        t.expected_calls
          .map((x) => `${i.names.get(x.tool_id) ?? x.tool_id} ${JSON.stringify(x.args)}`)
          .join(' → '),
      ]),
    ),
    '',
  );

  // definitions + reproduce
  md.push(
    '## Definitions',
    '',
    "- **N**: tools in the catalog the agent searches: the trial's own target tool(s) plus N − (targets) others",
    '  from a fixed shuffled order, so a smaller catalog is always a subset of a bigger one.',
    '- **k**: tools returned per search. The agent starts with no domain tools and calls `request_tools(need)`;',
    '  in `direct` mode `need` is embedded and the top-k tools come back; in `rerank` mode the top 50 are',
    '  re-ordered by a local cross-encoder first; in `query_agent` mode a second',
    '  model searches (with filters) and hands back ≤ k tools.',
    '- **recall@k**: every target tool was delivered to the agent by some search.',
    '- **failure type**, first match wins: hallucinated_tool (called a tool that does not exist) → retrieval_miss',
    '  (a target never delivered) → bad_args (target called, arguments wrong) → wrong_tool (called other',
    '  tools instead) → step_limit (ran out of turns) → gave_up (stopped). For two-step tasks it describes',
    '  the first step not done.',
    '- **chain** task: create something, then act on it by the id the first call returned. **cross_app**:',
    '  two independent jobs in apps of different categories.',
    '',
    '## Reproduce',
    '',
    `Environment of this write-up: ${Object.entries(m.env)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}.`,
    '',
    '```sh',
    'npm install',
    'docker compose up -d qdrant',
    `${m.gen_command}   # deterministic`,
    `shasum -a 256 ${m.data.tools_file} ${m.data.tasks_file}`,
    `#   expect ${m.data.tools_sha256}  ${m.data.tools_file}`,
    `#          ${m.data.tasks_sha256}  ${m.data.tasks_file}`,
    'npm run index        # embeds 200k tools into Qdrant, ≈7 min (cached after the first run)',
    m.command,
    `npm run results -- --run-id ${m.run_id}   # this folder`,
    '```',
    '',
    'The data is bit-identical on any machine; the model is not (it is sampled, and `claude -p` exposes no',
    'temperature), so a rerun should land inside the intervals above rather than match trial by trial.',
    'The sweep resumes where it left off if interrupted and pauses itself near the subscription window limit.',
    '',
    'Fixed knobs:',
    '',
    table(
      ['knob', 'value'],
      Object.entries(m.knobs).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
    ),
    '',
    'Worker system prompt:',
    '',
    '```text',
    i.workerPrompt,
    '```',
    '',
    '## Files in this folder',
    '',
    '- `trials.csv`: one row per trial (settings, outcome, metrics, tokens, latency).',
    '- `cells.csv`: one row per setting, with rates and 95% intervals.',
    '- `tasks.csv`: prompts and expected calls.',
    '- `manifest.json`: everything above in machine-readable form (command, versions, checksums, knobs).',
    '- `figures/`: the charts (SVG; light/dark aware).',
    '- `report.html`: interactive report for this run only, with a step-by-step story per trial.',
    '',
  );
  files['README.md'] = md.join('\n');

  // CSVs
  const csv = (head: string[], rows: unknown[][]) =>
    [head, ...rows]
      .map((r) =>
        r
          .map((v) => {
            const s = v === null || v === undefined ? '' : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(','),
      )
      .join('\n') + '\n';
  files['trials.csv'] = csv(
    [
      'trial_key',
      'run_id',
      'task_id',
      'kind',
      'N',
      'k',
      'mode',
      'model',
      'qa_model',
      'repeat',
      'success',
      'failure_type',
      'search_hit',
      'retrieval_hit',
      'selection_correct',
      'args_correct',
      'parts_done',
      'parts_total',
      'confusers_same_action',
      'confusers_same_vendor',
      'llm_calls',
      'qa_llm_calls',
      'input_tokens',
      'output_tokens',
      'latency_ms',
      'error',
      'started_at',
    ],
    i.records.map((r) => [
      r.trial_key,
      r.run_id,
      r.task_id,
      taskKind(r),
      r.N,
      r.k,
      r.mode,
      r.model,
      r.qa_model,
      r.repeat,
      r.metrics.success,
      r.failure_type,
      r.metrics.search_hit,
      r.metrics.retrieval_hit,
      r.metrics.selection_correct,
      r.metrics.args_correct,
      r.metrics.parts_done,
      r.metrics.parts_total,
      r.confusers?.same_action,
      r.confusers?.same_vendor,
      r.usage.llm_calls,
      r.usage.query_agent_llm_calls,
      r.usage.input_tokens,
      r.usage.output_tokens,
      r.latency_ms,
      r.error ?? '',
      r.started_at,
    ]),
  );
  const cells = groups.flatMap((g) => g.cells);
  files['cells.csv'] = csv(
    [
      'mode',
      'model',
      'N',
      'k',
      'n',
      'success',
      'success_lo',
      'success_hi',
      'recall',
      'recall_lo',
      'recall_hi',
      'select_given_hit',
      'args_given_select',
      ...FAILURE_TYPES,
      'mean_input_tokens',
      'mean_latency_ms',
    ],
    cells.map((c) => [
      c.mode,
      c.model,
      c.N,
      c.k,
      c.n,
      c.success.p,
      c.success.lo,
      c.success.hi,
      c.retrieval_hit.p,
      c.retrieval_hit.lo,
      c.retrieval_hit.hi,
      c.selection_given_hit.p,
      c.args_given_selection.p,
      ...FAILURE_TYPES.map((f) => c.failures[f]),
      Math.round(c.mean_input_tokens),
      Math.round(c.mean_latency_ms),
    ]),
  );
  files['tasks.csv'] = csv(
    ['task_id', 'kind', 'prompt', 'targets', 'expected_calls'],
    tasksUsed.map((t) => [
      t.task_id,
      kindOf(t),
      t.prompt,
      t.target_tool_ids.map((id) => i.names.get(id) ?? id).join(' → '),
      JSON.stringify(t.expected_calls),
    ]),
  );
  files['manifest.json'] = JSON.stringify(m, null, 2) + '\n';
  return files;
}

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
  /** one experiment command per retrieval mode */
  commands: string[];
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
  Number.isNaN(r.p) ? '–' : `${pct(r.p)} (${Math.round(r.lo * 100)}–${Math.round(r.hi * 100)})`;
const cellText = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const table = (head: string[], rows: (string | number)[][]) =>
  [
    `| ${head.map(cellText).join(' | ')} |`,
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
  const code = (xs: string[]) => [...new Set(xs)].map((x) => `\`${x}\``).join(', ');
  const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
  const targets = targetsOf(r);
  const calls = r.events.filter((e): e is Call => e.type === 'tool_call');
  const delivered = new Set(
    r.events.flatMap((e) => (e.type === 'retrieval' ? e.hits.map((h) => h.tool_id) : [])),
  );
  const needs = r.events.flatMap((e) => (e.type === 'retrieval' ? [e.need] : []));
  const parts =
    (r.metrics.parts_total ?? 1) > 1
      ? ` (${r.metrics.parts_done} of ${r.metrics.parts_total} parts done)`
      : '';
  const base = (() => {
    switch (r.failure_type) {
      case 'retrieval_miss': {
        const missing = targets.filter((t) => !delivered.has(t)).map((t) => names.get(t) ?? t);
        const asked = needs
          .slice(0, 2)
          .map((n) => `"${clip(n, 60)}"`)
          .join(', ');
        const more = needs.length > 2 ? ` and ${needs.length - 2} more` : '';
        return `never got ${code(missing)}; searched ${asked || 'nothing'}${more}`;
      }
      case 'wrong_tool': {
        const called = calls.filter((c) => c.tool_id && !targets.includes(c.tool_id));
        const missed = targets.filter((t) => !calls.some((c) => c.tool_id === t));
        return `called ${code(called.map((c) => bare(c.tool_name)))} instead of ${code(
          missed.map((t) => names.get(t) ?? t),
        )}`;
      }
      case 'bad_args': {
        const c = calls.filter((x) => x.tool_id && targets.includes(x.tool_id)).at(-1);
        return c ? `called ${code([bare(c.tool_name)])} with ${short(c.args, 70)}` : '';
      }
      case 'hallucinated_tool': {
        const made = calls.filter((c) => c.tool_id === null).map((c) => bare(c.tool_name));
        return `called ${code(made)}, which doesn't exist`;
      }
      case 'gave_up': {
        const f = r.events.find((e) => e.type === 'finish');
        if (!f || f.type !== 'finish') return 'stopped without finishing';
        const said = f.summary.replace(/mcp__ts__/g, '').split(/(?<=[.!?])\s/)[0] ?? '';
        return `said "${clip(said, 110)}"`;
      }
      case 'step_limit':
        return `ran out of turns after ${r.metrics.steps} steps`;
      default:
        return '';
    }
  })();
  return (r.error ? `error: ${clip(r.error, 80)}; ` : '') + base + parts;
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

function pairedTable(g: Group): string {
  const Ns = uniqueSorted(g.rows.map((r) => r.N));
  const ks = uniqueSorted(g.rows.map((r) => r.k));
  const at = (N: number, k: number) => g.rows.filter((r) => r.N === N && r.k === k);
  const rows: string[][] = [];
  const pair = (fixed: string, a: TrialRecord[], b: TrialRecord[], change: string) => {
    const f = flips(a, b);
    rows.push([fixed, change, f.both, f.onlyA, f.onlyB, f.neither, f.p.toFixed(3)].map(String));
  };
  const [n0, n1, k0, k1] = [Ns[0]!, Ns.at(-1)!, ks[0]!, ks.at(-1)!];
  if (Ns.length > 1)
    for (const k of ks) pair(`k=${k}`, at(n0, k), at(n1, k), `N ${fmtN(n0)} → ${fmtN(n1)}`);
  if (ks.length > 1)
    for (const N of Ns) pair(`N=${fmtN(N)}`, at(N, k0), at(N, k1), `k ${k0} → ${k1}`);
  if (!rows.length) return '';
  return table(
    ['fixed', 'change', 'pass both', 'only before', 'only after', 'fail both', 'p'],
    rows,
  );
}

function breakdownTable(rows: BreakdownRow[], first: string): string {
  return table(
    [first, 'n', 'success', 'delivered', 'picked when delivered', 'parts done'],
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
  direct: '**direct**: embed the request, hand over the top k.',
  rerank:
    '**re-ranker**: take the top 50, re-order them with a small local cross-encoder, hand over k.',
  query_agent: '**librarian**: a second model runs filtered searches and picks up to k.',
};

/** Every retrieval mode vs direct on the settings both ran: a short summary and the full tables. */
function modeComparison(
  records: TrialRecord[],
  files: Record<string, string>,
): { main: string; details: string } {
  const none = { main: '', details: '' };
  const modes = uniqueSorted(records.map((r) => r.mode)).sort(
    (a, b) => MODE_ORDER.indexOf(a) - MODE_ORDER.indexOf(b),
  );
  const others = modes.filter((m) => m !== 'direct');
  if (!modes.includes('direct') || !others.length) return none;
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
  if (!settings.length) return none;
  const Ns = uniqueSorted(settings.map((s) => s.N));
  const label = (s: Setting) => (Ns.length === 1 ? `k=${s.k}` : `N=${fmtN(s.N)} · k=${s.k}`);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const rerankMs = (rs: TrialRecord[]) =>
    mean(
      rs.flatMap((r) =>
        r.events.flatMap((e) =>
          e.type === 'retrieval' && e.reranker ? [e.reranker.latency_ms] : [],
        ),
      ),
    );
  const where = Ns.length === 1 ? ` at ${fmtN(Ns[0]!)} tools` : '';

  files['figures/modes.svg'] = lineChartSvg({
    title: `Search methods compared${where}`,
    subtitle: 'same tasks, same catalogs · whiskers = 95% CI',
    xLabel: 'tools per search',
    xs: settings.map(label),
    series: modes.map((mode) => ({
      name: MODE_SHORT[mode] ?? mode,
      slot: Math.max(0, MODE_ORDER.indexOf(mode)),
      points: settings.flatMap((s) => {
        const rs = at(mode, s);
        if (!rs.length) return [];
        const c = aggregate(rs)[0]!;
        return [{ x: label(s), y: c.success.p, lo: c.success.lo, hi: c.success.hi, n: c.n }];
      }),
    })),
  });

  const perMode = (full: boolean) =>
    settings.flatMap((s) =>
      modes.flatMap((mode) => {
        const rs = at(mode, s);
        if (!rs.length) return [];
        const c = aggregate(rs)[0]!;
        const name = MODE_SHORT[mode] ?? mode;
        const calls = c.mean_llm_calls.toFixed(1);
        const secs = (c.mean_latency_ms / 1000).toFixed(0);
        if (!full) return [[label(s), name, pct(c.success.p), pct(c.retrieval_hit.p), calls, secs]];
        return [
          [
            label(s),
            name,
            c.n,
            ci(c.success),
            pct(c.retrieval_hit.p),
            pct(c.selection_given_hit.p),
            calls,
            `${(c.mean_input_tokens / 1000).toFixed(0)}k`,
            secs,
            `$${mean(rs.map((r) => r.cost_usd)).toFixed(3)}`,
          ],
        ];
      }),
    );
  const rerankTrials = records.filter((r) => r.mode === 'rerank');
  const rerankNote = rerankTrials.length
    ? ` The re-ranker took about ${Math.round(rerankMs(rerankTrials))} ms per search on CPU.`
    : '';
  const head = ['setting', 'method', 'success', 'delivered', 'model calls', 'seconds'];
  const paired = settings.flatMap((s) =>
    others.flatMap((mode) => {
      if (!at(mode, s).length) return [];
      const f = flips(at('direct', s), at(mode, s));
      const name = MODE_SHORT[mode] ?? mode;
      return [[label(s), name, f.both, f.onlyA, f.onlyB, f.neither, f.p.toFixed(3)]];
    }),
  );
  return {
    main: [
      `## Search methods${where}`,
      '',
      modes.map((m) => `- ${MODE_TEXT[m] ?? m}`).join('\n'),
      '',
      '![Search methods compared](figures/modes.svg)',
      '',
      table(head, perMode(false)),
    ].join('\n'),
    details: [
      '## Search methods',
      '',
      'Per trial averages. The price is what Claude Code reports the trial would cost at API prices' +
        ' (nothing is billed on a subscription).' +
        rerankNote,
      '',
      table(
        [
          'setting',
          'method',
          'n',
          'success',
          'delivered',
          'picked when delivered',
          'model calls',
          'input tokens',
          'seconds',
          'price',
        ],
        perMode(true),
      ),
      '',
      'Each method against direct, task by task:',
      '',
      table(
        ['setting', 'method', 'pass both', 'only direct', 'only method', 'fail both', 'p'],
        paired,
      ),
    ].join('\n'),
  };
}

/** Break a long shell command into `\`-continued lines of at most `width` characters. */
export function wrapCommand(cmd: string, width = 90): string {
  const parts = cmd.split(/ (?=--[a-z])/);
  const lines = [parts[0]!];
  for (const part of parts.slice(1)) {
    if (lines.at(-1)!.length + part.length + 3 > width) lines.push(`  ${part}`);
    else lines[lines.length - 1] += ` ${part}`;
  }
  return lines.join(' \\\n');
}

const outcomeCats = [
  { name: 'pass', slot: 'neutral' as const },
  ...FAILURE_TYPES.map((f, idx) => ({ name: f.replace('_', ' '), slot: idx })),
];

export function buildWriteup(i: WriteupInput): Record<string, string> {
  const m = i.manifest;
  const files: Record<string, string> = {};
  const md: string[] = [];
  const dt: string[] = [];
  const groups = groupsOf(i.records);
  const tasksUsed = i.tasks.filter((t) => m.tasks.includes(t.task_id));
  const kindOf = (t: Task) =>
    t.tags.multi_step ? (t.tags.cross_app ? 'cross_app' : 'chain') : 'single';
  const days = [m.first_trial_at, m.last_trial_at].map((d) => d.slice(0, 10));
  const modes = modeComparison(i.records, files);

  md.push(
    `# Results: \`${m.run_id}\``,
    '',
    [
      m.models.join(', '),
      `${m.tasks.length} tasks`,
      `catalogs of ${m.N.map(fmtN).join(' / ')} tools`,
      `${m.trials} trials`,
      days[0] === days[1] ? days[0] : `${days[0]} → ${days[1]}`,
    ].join(' · '),
    '',
    i.findings?.trim() || '_No findings yet: add `FINDINGS.md` here and re-run `npm run results`._',
    '',
  );
  dt.push(
    `# Details: \`${m.run_id}\``,
    '',
    'Percentages in parentheses are 95% Wilson intervals. `p` is an exact McNemar test on the tasks that',
    'pass in one setting and fail in the other.',
    '',
  );

  const outcomes: string[] = [];
  const curveGroups = groups.filter((g) => uniqueSorted(g.rows.map((r) => r.N)).length > 1).length;
  for (const g of groups) {
    const suffix = g.label ? ` (${g.label})` : '';
    const curveSuffix = curveGroups > 1 ? suffix : '';
    const slug = `${g.mode}-${g.model}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const Ns = uniqueSorted(g.cells.map((c) => c.N));
    const ks = uniqueSorted(g.cells.map((c) => c.k));
    const series = (pick: (c: Cell) => Cell['success']) =>
      ks.map((k, si) => ({
        name: `k=${k}`,
        slot: si,
        points: g.cells
          .filter((c) => c.k === k)
          .map((c) => {
            const r = pick(c);
            return { x: fmtN(c.N), y: r.p, lo: r.lo, hi: r.hi, n: r.n };
          }),
      }));
    const byNk = (pick: (c: Cell) => Cell['success'], withCi = false) =>
      table(
        ['tools', ...ks.map((k) => `k=${k}`)],
        Ns.map((N) => [
          fmtN(N),
          ...ks.map((k) => {
            const c = g.cells.find((x) => x.N === N && x.k === k);
            return c ? (withCi ? ci(pick(c)) : pct(pick(c).p)) : '–';
          }),
        ]),
      );

    files[`figures/outcomes-${slug}.svg`] = stackedBarsSvg({
      title: `How trials ended${suffix}`,
      subtitle: 'first thing that went wrong',
      categories: outcomeCats,
      rows: g.cells.map((c) => ({
        label: `N=${fmtN(c.N)} · k=${c.k}`,
        counts: [Math.round(c.success.p * c.n), ...FAILURE_TYPES.map((f) => c.failures[f])],
      })),
    });
    outcomes.push(
      `## How trials ended${suffix}`,
      '',
      `![How trials ended](figures/outcomes-${slug}.svg)`,
      '',
      table(
        ['tools', 'k', 'n', 'pass', ...FAILURE_TYPES.map((f) => f.replace('_', ' '))],
        g.cells.map((c) => [
          fmtN(c.N),
          c.k,
          c.n,
          Math.round(c.success.p * c.n),
          ...FAILURE_TYPES.map((f) => c.failures[f]),
        ]),
      ),
      '',
    );

    // curves only for groups that span several catalog sizes; the rest are in the method comparison
    if (Ns.length < 2) continue;
    files[`figures/success-${slug}.svg`] = lineChartSvg({
      title: 'Success rate vs catalog size',
      subtitle: 'one line per k, tools returned per search · whiskers = 95% CI',
      xLabel: 'tools in the catalog',
      xs: Ns.map(fmtN),
      series: series((c) => c.success),
    });
    files[`figures/recall-${slug}.svg`] = lineChartSvg({
      title: 'How often the right tool reached the agent',
      subtitle: 'one line per k · whiskers = 95% CI',
      xLabel: 'tools in the catalog',
      xs: Ns.map(fmtN),
      series: series((c) => c.retrieval_hit),
    });
    md.push(
      `## Catalog size${curveSuffix}`,
      '',
      `![Success rate vs catalog size](figures/success-${slug}.svg)`,
      '',
      byNk((c) => c.success),
      '',
      `![Right tool delivered vs catalog size](figures/recall-${slug}.svg)`,
      '',
      byNk((c) => c.retrieval_hit),
      '',
    );
    dt.push(
      `## Catalog size${curveSuffix}`,
      '',
      'Success:',
      '',
      byNk((c) => c.success, true),
      '',
      'Right tool delivered to the agent:',
      '',
      byNk((c) => c.retrieval_hit, true),
      '',
      'Right tool picked, when it was delivered:',
      '',
      byNk((c) => c.selection_given_hit, true),
      '',
      'Same task in two settings:',
      '',
      pairedTable(g),
      '',
    );
  }

  if (modes.main) md.push(modes.main, '');
  if (modes.details) dt.push(modes.details, '');
  dt.push(...outcomes);

  dt.push(
    '## By task kind',
    '',
    breakdownTable(breakdown(i.records, taskKind, ['single', 'chain', 'cross_app']), 'kind'),
    '',
    '## By look-alikes',
    '',
    "Other tools in the trial's catalog with the same resource and action as the target, e.g. every",
    '"delete job posting" tool. This grows with catalog size, so it overlaps with that effect.',
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
    'Counting only the same vendor (other editions, other id forms):',
    '',
    breakdownTable(
      breakdown(
        i.records,
        (r) => (r.confusers ? confuserBucket(r.confusers.same_vendor) : null),
        CONFUSER_BUCKETS,
      ),
      'same vendor',
    ),
    '',
    '## Every task',
    '',
    '✓ pass · RM retrieval miss · WT wrong tool · BA bad args · HT hallucinated tool · GU gave up ·',
    'SL step limit · ERR error',
    '',
  );
  for (const g of groups) {
    const cols = uniqueSorted(g.rows.map((r) => r.N)).flatMap((N) =>
      uniqueSorted(g.rows.filter((r) => r.N === N).map((r) => r.k)).map((k) => ({ N, k })),
    );
    const taskIds = uniqueSorted(g.rows.map((r) => r.task_id));
    if (g.label) dt.push(`**${g.label}**`, '');
    dt.push(
      table(
        ['task', 'kind', ...cols.map((c) => `${fmtN(c.N)} k${c.k}`), 'pass'],
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

  dt.push(
    '## Failures',
    '',
    table(
      ['task', 'method', 'tools', 'k', 'outcome', 'what happened'],
      i.records
        .filter((r) => !r.metrics.success)
        .map((r) => [
          r.task_id,
          MODE_SHORT[r.mode] ?? r.mode,
          fmtN(r.N),
          r.k,
          r.failure_type?.replace('_', ' ') ?? 'error',
          whatHappened(r, i.names),
        ]),
    ),
    '',
    '## Tasks',
    '',
    table(
      ['task', 'kind', 'prompt', 'expected tool'],
      tasksUsed.map((t) => [
        t.task_id,
        kindOf(t),
        t.prompt,
        t.expected_calls.map((x) => `\`${i.names.get(x.tool_id) ?? x.tool_id}\``).join(' → '),
      ]),
    ),
    '',
    '## Terms',
    '',
    "- **tools / N**: catalog size. The trial's own target plus N − 1 others from a fixed shuffle, so a",
    '  smaller catalog is a subset of a bigger one.',
    '- **k**: tools handed to the agent per search.',
    '- **delivered**: every target reached the agent through some search.',
    '- **outcome**: the first thing that went wrong, in this order: hallucinated tool, retrieval miss,',
    '  bad args, wrong tool, step limit, gave up. For two-step tasks, the first step not done.',
    '- **chain**: create something, then act on it by the id that came back. **cross_app**: two',
    '  unrelated jobs in different apps.',
    '',
    '## Setup',
    '',
    `${Object.entries(m.env)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')}`,
    '',
    'Data checksums after `npm run gen`:',
    '',
    '```text',
    `${m.data.tools_sha256}  ${m.data.tools_file}`,
    `${m.data.tasks_sha256}  ${m.data.tasks_file}`,
    '```',
    '',
    table(
      ['setting', 'value'],
      Object.entries(m.knobs).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
    ),
    '',
    'Worker system prompt:',
    '',
    '```text',
    i.workerPrompt,
    '```',
    '',
  );

  md.push(
    '## Reproduce',
    '',
    '```sh',
    'npm install && docker compose up -d qdrant',
    m.gen_command,
    'npm run index',
    // a rerun gets its own id, so it doesn't append to this run's records
    ...m.commands.map((c) =>
      wrapCommand(c.replace(`--run-id ${m.run_id}`, `--run-id ${m.run_id}-rerun`)),
    ),
    `npm run results -- --run-id ${m.run_id}-rerun`,
    '```',
    '',
    'The model is sampled, so a rerun lands near these numbers rather than on them. More tables are in',
    '[details.md](details.md), every trial is in `trials.csv`, and `report.html` shows the searches and',
    'calls of each one.',
    '',
  );
  files['README.md'] = md.join('\n');
  files['details.md'] = dt.join('\n');

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

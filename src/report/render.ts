/**
 * Browser-side renderer for report.html. Transpiled and inlined by html.ts together with stats.ts
 * (imports below are stripped at build time; both files share one module scope in the page).
 * Reads the trial records from <script id="data">, then draws: filter row → stat tiles → charts →
 * trial table → one trial's searches and calls.
 */
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
import type { FailureType, TraceEvent, TrialRecord } from '../types.js';

// ---------- palette (validated categorical slots, light/dark) ----------
const SLOTS_LIGHT = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
];
const SLOTS_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];
const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
const slot = (i: number) => (isDark() ? SLOTS_DARK : SLOTS_LIGHT)[i % 8]!;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = (
  tag: string,
  attrs: Record<string, string | number> = {},
  ...children: (Node | string)[]
) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...children);
  return e;
};
const svgEl = (
  tag: string,
  attrs: Record<string, string | number> = {},
  ...children: (Node | string)[]
) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...children);
  return e;
};
const fmtPct = (p: number) => (Number.isNaN(p) ? '–' : `${Math.round(p * 100)}%`);
const fmtNum = (x: number) =>
  Number.isNaN(x) ? '–' : x >= 1000 ? `${(x / 1000).toFixed(1)}k` : String(Math.round(x));
const fmtN = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(n));

// ---------- data ----------
const DATA = JSON.parse($('#data').textContent!) as { generated: string; trials: TrialRecord[] };
const trials = DATA.trials;
const allN = uniqueSorted(trials.map((t) => t.N));
const colorForN = (N: number) => slot(allN.indexOf(N));
// fixed order so a mode keeps its color whichever modes a run contains
const MODES = ['direct', 'rerank', 'query_agent'];
const allModes = uniqueSorted(trials.map((t) => t.mode)).sort(
  (a, b) => MODES.indexOf(a) - MODES.indexOf(b),
);
const colorForMode = (mode: string) => slot(Math.max(0, MODES.indexOf(mode)));
const colorForFailure = (f: FailureType) => slot(FAILURE_TYPES.indexOf(f));

// ---------- filters ----------
interface Filters {
  backend: string;
  model: string;
  mode: string;
  N: number;
}
const filters: Filters = {
  backend: uniqueSorted(trials.map((t) => t.backend))[0] ?? '',
  model: uniqueSorted(trials.map((t) => t.model))[0] ?? '',
  mode: 'direct',
  N: allN[allN.length - 1] ?? 0,
};

function select(
  label: string,
  options: (string | number)[],
  value: string | number,
  onChange: (v: string) => void,
) {
  const s = el('select') as HTMLSelectElement;
  for (const o of options)
    s.append(
      el(
        'option',
        { value: o, ...(String(o) === String(value) ? { selected: '' } : {}) },
        String(o),
      ),
    );
  s.addEventListener('change', () => onChange(s.value));
  return el('label', { class: 'filter' }, label, s);
}

function renderFilters() {
  const row = $('#filters');
  row.replaceChildren(
    select('backend', uniqueSorted(trials.map((t) => t.backend)), filters.backend, (v) => {
      filters.backend = v;
      renderAll();
    }),
    select('model', uniqueSorted(trials.map((t) => t.model)), filters.model, (v) => {
      filters.model = v;
      renderAll();
    }),
    select('mode', allModes, filters.mode, (v) => {
      filters.mode = v;
      renderAll();
    }),
    select('N (mode comparison)', allN, filters.N, (v) => {
      filters.N = Number(v);
      renderAll();
    }),
  );
}

const cellsFor = (pred: (c: Cell) => boolean) =>
  aggregate(trials).filter(
    (c) => c.backend === filters.backend && c.model === filters.model && pred(c),
  );

// ---------- line chart ----------
interface Point {
  x: number;
  y: number;
  lo?: number;
  hi?: number;
  n: number;
}
interface Series {
  name: string;
  color: string;
  points: Point[];
}
interface LineChartOpts {
  title: string;
  series: Series[];
  xs: number[];
  yMax?: number;
  yFmt: (y: number) => string;
  note?: string;
}

function lineChart(o: LineChartOpts): HTMLElement {
  const W = 520,
    H = 260,
    m = { t: 28, r: 72, b: 40, l: 48 };
  const iw = W - m.l - m.r,
    ih = H - m.t - m.b;
  const xs = o.xs;
  const yMax =
    o.yMax ?? Math.max(1e-9, ...o.series.flatMap((s) => s.points.map((p) => p.hi ?? p.y))) * 1.05;
  const X = (x: number) => m.l + (xs.indexOf(x) / Math.max(1, xs.length - 1)) * iw;
  const Y = (y: number) => m.t + ih - (y / yMax) * ih;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' });
  svg.append(svgEl('text', { x: m.l, y: 16, class: 'chart-title' }, o.title));
  // recessive grid + axes
  for (let i = 0; i <= 4; i++) {
    const y = m.t + (ih * i) / 4;
    svg.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: 'grid' }));
    svg.append(
      svgEl(
        'text',
        { x: m.l - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' },
        o.yFmt(yMax * (1 - i / 4)),
      ),
    );
  }
  for (const x of xs)
    svg.append(
      svgEl(
        'text',
        { x: X(x), y: H - m.b + 18, class: 'tick', 'text-anchor': 'middle' },
        String(x),
      ),
    );
  svg.append(
    svgEl(
      'text',
      { x: W - m.r, y: H - 6, class: 'tick', 'text-anchor': 'end' },
      'k (tools returned)',
    ),
  );
  svg.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, class: 'axis' }));

  const labels: { y: number; text: string; x: number }[] = [];
  for (const s of o.series) {
    const pts = s.points.filter((p) => !Number.isNaN(p.y));
    if (!pts.length) continue;
    svg.append(
      svgEl('path', {
        d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)},${Y(p.y)}`).join(' '),
        class: 'line',
        stroke: s.color,
      }),
    );
    for (const p of pts) {
      if (p.lo !== undefined && p.hi !== undefined) {
        svg.append(
          svgEl('line', {
            x1: X(p.x),
            x2: X(p.x),
            y1: Y(p.lo),
            y2: Y(p.hi),
            class: 'ci',
            stroke: s.color,
          }),
        );
      }
      svg.append(svgEl('circle', { cx: X(p.x), cy: Y(p.y), r: 4, fill: s.color, class: 'marker' }));
    }
    const last = pts[pts.length - 1]!;
    labels.push({ y: Y(last.y) + 4, text: s.name, x: X(last.x) + 7 });
  }
  // direct labels: push apart vertically so converging series stay readable
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++)
    labels[i]!.y = Math.max(labels[i]!.y, labels[i - 1]!.y + 11);
  for (let i = labels.length - 2; i >= 0; i--)
    labels[i]!.y = Math.min(labels[i]!.y, labels[i + 1]!.y - 11);
  for (const l of labels)
    svg.append(svgEl('text', { x: l.x, y: l.y, class: 'direct-label' }, l.text));

  // hover: nearest k, one tooltip listing every series
  const cross = svgEl('line', { y1: m.t, y2: m.t + ih, class: 'crosshair', visibility: 'hidden' });
  svg.append(cross);
  const tip = el('div', { class: 'tooltip', hidden: '' });
  const wrap = el('figure', { class: 'fig' }, svg, tip);
  svg.addEventListener('mousemove', (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = xs[0]!;
    for (const x of xs) if (Math.abs(X(x) - px) < Math.abs(X(best) - px)) best = x;
    cross.setAttribute('x1', String(X(best)));
    cross.setAttribute('x2', String(X(best)));
    cross.setAttribute('visibility', 'visible');
    tip.replaceChildren(
      el('div', { class: 'tip-head' }, `k = ${best}`),
      ...o.series.map((s) => {
        const p = s.points.find((q) => q.x === best);
        const v = p
          ? `${o.yFmt(p.y)}${p.lo !== undefined ? ` (${o.yFmt(p.lo!)}–${o.yFmt(p.hi!)})` : ''} · n=${p.n}`
          : '–';
        return el(
          'div',
          { class: 'tip-row' },
          el('span', { class: 'swatch', style: `background:${s.color}` }),
          `${s.name}: ${v}`,
        );
      }),
    );
    tip.hidden = false;
    tip.style.left = `${Math.min(ev.clientX - r.left + 12, r.width - 220)}px`;
    tip.style.top = `${ev.clientY - r.top + 12}px`;
  });
  svg.addEventListener('mouseleave', () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
  });

  if (o.series.length >= 2) {
    wrap.append(
      el(
        'div',
        { class: 'legend' },
        ...o.series.map((s) =>
          el(
            'span',
            { class: 'legend-item' },
            el('span', { class: 'swatch', style: `background:${s.color}` }),
            s.name,
          ),
        ),
      ),
    );
  }
  if (o.note) wrap.append(el('figcaption', {}, o.note));
  return wrap;
}

// ---------- stacked bars (failure types by k) ----------
function failureChart(cells: Cell[], title: string): HTMLElement {
  const W = 520,
    H = 260,
    m = { t: 28, r: 16, b: 40, l: 48 };
  const iw = W - m.l - m.r,
    ih = H - m.t - m.b;
  const ks = uniqueSorted(cells.map((c) => c.k));
  const bw = Math.min(48, (iw / Math.max(1, ks.length)) * 0.6);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' });
  svg.append(svgEl('text', { x: m.l, y: 16, class: 'chart-title' }, title));
  for (let i = 0; i <= 4; i++) {
    const y = m.t + (ih * i) / 4;
    svg.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: 'grid' }));
    svg.append(
      svgEl(
        'text',
        { x: m.l - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' },
        fmtPct(1 - i / 4),
      ),
    );
  }
  svg.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, class: 'axis' }));
  const tip = el('div', { class: 'tooltip', hidden: '' });
  ks.forEach((k, i) => {
    const c = cells.find((x) => x.k === k)!;
    const cx = m.l + ((i + 0.5) / ks.length) * iw;
    svg.append(
      svgEl('text', { x: cx, y: H - m.b + 18, class: 'tick', 'text-anchor': 'middle' }, `k=${k}`),
    );
    let y = m.t + ih;
    const parts: { name: string; value: number; color: string }[] = [
      { name: 'success', value: c.success.p, color: 'var(--neutral-fill)' },
      ...FAILURE_TYPES.map((f) => ({
        name: f,
        value: c.failures[f] / c.n,
        color: colorForFailure(f),
      })),
    ];
    for (const p of parts) {
      if (!p.value) continue;
      const h = p.value * ih;
      const rect = svgEl('rect', {
        x: cx - bw / 2,
        y: y - h + 1,
        width: bw,
        height: Math.max(0, h - 2),
        fill: p.color,
        rx: 2,
      });
      rect.addEventListener('mousemove', (ev) => {
        const r = svg.getBoundingClientRect();
        tip.replaceChildren(
          el('div', { class: 'tip-head' }, `k=${k} · ${p.name}`),
          el('div', { class: 'tip-row' }, `${fmtPct(p.value)} of ${c.n} trials`),
        );
        tip.hidden = false;
        tip.style.left = `${ev.clientX - r.left + 12}px`;
        tip.style.top = `${ev.clientY - r.top + 12}px`;
      });
      rect.addEventListener('mouseleave', () => (tip.hidden = true));
      svg.append(rect);
      y -= h;
    }
  });
  const legend = el(
    'div',
    { class: 'legend' },
    el(
      'span',
      { class: 'legend-item' },
      el('span', { class: 'swatch', style: 'background:var(--neutral-fill)' }),
      'success',
    ),
    ...FAILURE_TYPES.map((f) =>
      el(
        'span',
        { class: 'legend-item' },
        el('span', { class: 'swatch', style: `background:${colorForFailure(f)}` }),
        f,
      ),
    ),
  );
  return el('figure', { class: 'fig' }, svg, tip, legend);
}

// ---------- charts section ----------
function seriesByN(
  cells: Cell[],
  pick: (c: Cell) => { y: number; lo?: number; hi?: number },
): Series[] {
  return uniqueSorted(cells.map((c) => c.N)).map((N) => ({
    name: `N=${fmtN(N)}`,
    color: colorForN(N),
    points: cells.filter((c) => c.N === N).map((c) => ({ x: c.k, n: c.n, ...pick(c) })),
  }));
}

function renderCharts() {
  const cells = cellsFor((c) => c.mode === filters.mode);
  const ks = uniqueSorted(cells.map((c) => c.k));
  const rateOf = (r: Cell['success']) => ({ y: r.p, lo: r.lo, hi: r.hi });
  const pct = { yMax: 1, yFmt: fmtPct };
  const grid = $('#charts');
  grid.replaceChildren(
    lineChart({
      title: 'Success rate vs k',
      series: seriesByN(cells, (c) => rateOf(c.success)),
      xs: ks,
      ...pct,
      note: 'Bars are 95% Wilson intervals.',
    }),
    lineChart({
      title: 'Recall@k (target delivered to worker) vs k',
      series: seriesByN(cells, (c) => rateOf(c.retrieval_hit)),
      xs: ks,
      ...pct,
    }),
    lineChart({
      title: 'Selection accuracy given retrieval hit',
      series: seriesByN(cells, (c) => rateOf(c.selection_given_hit)),
      xs: ks,
      ...pct,
      note: 'n counts only trials where the target was delivered.',
    }),
    ...uniqueSorted(cells.map((c) => c.N)).map((N) =>
      failureChart(
        cells.filter((c) => c.N === N),
        `Outcomes by k · N=${fmtN(N)}`,
      ),
    ),
    lineChart({
      title: 'Mean input tokens per trial vs k',
      series: seriesByN(cells, (c) => ({ y: c.mean_input_tokens })),
      xs: ks,
      yFmt: fmtNum,
    }),
    lineChart({
      title: 'Mean latency per trial (s) vs k',
      series: seriesByN(cells, (c) => ({ y: c.mean_latency_ms / 1000 })),
      xs: ks,
      yFmt: (y) => y.toFixed(1),
    }),
  );
  // mode comparison at the chosen N
  const modeCells = cellsFor((c) => c.N === filters.N);
  const mks = uniqueSorted(modeCells.map((c) => c.k));
  $('#mode-chart').replaceChildren(
    lineChart({
      title: `retrieval modes · success at N=${fmtN(filters.N)}`,
      series: allModes
        .map((mode) => ({
          name: mode,
          color: colorForMode(mode),
          points: modeCells
            .filter((c) => c.mode === mode)
            .map((c) => ({ x: c.k, n: c.n, ...rateOf(c.success) })),
        }))
        .filter((s) => s.points.length),
      xs: mks,
      ...pct,
    }),
    lineChart({
      title: `retrieval modes · recall@k at N=${fmtN(filters.N)}`,
      series: allModes
        .map((mode) => ({
          name: mode,
          color: colorForMode(mode),
          points: modeCells
            .filter((c) => c.mode === mode)
            .map((c) => ({ x: c.k, n: c.n, ...rateOf(c.retrieval_hit) })),
        }))
        .filter((s) => s.points.length),
      xs: mks,
      ...pct,
    }),
  );
}

function renderTiles() {
  const rows = trials.filter(
    (t) => t.backend === filters.backend && t.model === filters.model && t.mode === filters.mode,
  );
  const tile = (label: string, value: string) =>
    el(
      'div',
      { class: 'tile' },
      el('div', { class: 'tile-value' }, value),
      el('div', { class: 'tile-label' }, label),
    );
  $('#tiles').replaceChildren(
    tile('trials (this filter)', String(rows.length)),
    tile('success', fmtPct(rows.filter((r) => r.metrics.success).length / rows.length)),
    tile('recall@k', fmtPct(rows.filter((r) => r.metrics.retrieval_hit).length / rows.length)),
    tile(
      'mean llm calls',
      fmtNum(
        rows.reduce((a, r) => a + r.usage.llm_calls + r.usage.query_agent_llm_calls, 0) /
          rows.length,
      ),
    ),
    tile('total trials', String(trials.length)),
  );
}

// ---------- table of cells ----------
function renderCellTable() {
  const cells = cellsFor(() => true);
  const head = [
    'mode',
    'N',
    'k',
    'n',
    'success',
    'search hit',
    'recall@k',
    'select|hit',
    'args|select',
    ...FAILURE_TYPES.map((f) => f.replace('_', ' ')),
    'tokens in',
    'latency s',
  ];
  const body = cells.map((c) =>
    el(
      'tr',
      {},
      ...[
        c.mode,
        fmtN(c.N),
        c.k,
        c.n,
        fmtPct(c.success.p),
        fmtPct(c.search_hit.p),
        fmtPct(c.retrieval_hit.p),
        fmtPct(c.selection_given_hit.p),
        fmtPct(c.args_given_selection.p),
        ...FAILURE_TYPES.map((f) => c.failures[f] || ''),
        fmtNum(c.mean_input_tokens),
        (c.mean_latency_ms / 1000).toFixed(1),
      ].map((v) => el('td', {}, String(v))),
    ),
  );
  $('#cells').replaceChildren(
    el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))),
    el('tbody', {}, ...body),
  );
}

// ---------- breakdowns ----------
function breakdownTable(title: string, rows: BreakdownRow[], note?: string) {
  const head = ['', 'n', 'success', '95% CI', 'recall@k', 'select|hit', 'parts done'];
  const body = rows.map((b) =>
    el(
      'tr',
      {},
      ...[
        b.key,
        b.n,
        fmtPct(b.success.p),
        `${fmtPct(b.success.lo)}–${fmtPct(b.success.hi)}`,
        fmtPct(b.retrieval_hit.p),
        fmtPct(b.selection_given_hit.p),
        fmtPct(b.parts),
      ].map((v) => el('td', {}, String(v))),
    ),
  );
  return el(
    'div',
    {},
    el('h3', {}, title),
    el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        {},
        el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))),
        el('tbody', {}, ...body),
      ),
    ),
    note ? el('div', { class: 'muted' }, note) : '',
  );
}

function renderBreakdowns() {
  const rows = trials.filter(
    (t) => t.backend === filters.backend && t.model === filters.model && t.mode === filters.mode,
  );
  $('#breakdowns').replaceChildren(
    breakdownTable('By task kind', breakdown(rows, taskKind, ['single', 'chain', 'cross_app'])),
    breakdownTable(
      'By look-alikes in the catalog (same resource + action)',
      breakdown(
        rows,
        (r) => (r.confusers ? confuserBucket(r.confusers.same_action) : null),
        CONFUSER_BUCKETS,
      ),
      'Grows with N; pooling across N separates "many look-alikes" from "big catalog" only partly.',
    ),
    breakdownTable(
      'By same-vendor look-alikes (other editions, other id forms)',
      breakdown(
        rows,
        (r) => (r.confusers ? confuserBucket(r.confusers.same_vendor) : null),
        CONFUSER_BUCKETS,
      ),
    ),
    breakdownTable(
      'By task (a task that fails everywhere may be a generator bug)',
      breakdown(rows, (r) => r.task_id),
    ),
  );
}

// ---------- trial table + one trial ----------
const tf = { mode: '', N: '', k: '', outcome: '' };
function renderTrialTable() {
  const rows = trials.filter(
    (t) =>
      (!tf.mode || t.mode === tf.mode) &&
      (!tf.N || String(t.N) === tf.N) &&
      (!tf.k || String(t.k) === tf.k) &&
      (!tf.outcome || (tf.outcome === 'PASS' ? t.metrics.success : t.failure_type === tf.outcome)),
  );
  const opt = (label: string, key: keyof typeof tf, options: (string | number)[]) =>
    select(label, ['(all)', ...options], tf[key] || '(all)', (v) => {
      tf[key] = v === '(all)' ? '' : v;
      renderTrialTable();
    });
  $('#trial-filters').replaceChildren(
    opt('mode', 'mode', allModes),
    opt('N', 'N', allN),
    opt('k', 'k', uniqueSorted(trials.map((t) => t.k))),
    opt('outcome', 'outcome', ['PASS', ...FAILURE_TYPES]),
    el('span', { class: 'muted' }, `${rows.length} trials · click a row`),
  );
  const head = [
    'task',
    'kind',
    'mode',
    'N',
    'k',
    'model',
    'outcome',
    'steps',
    'llm calls',
    'tokens in',
    'latency s',
  ];
  const body = rows.map((t) => {
    const tr = el(
      'tr',
      { class: t.metrics.success ? 'pass' : 'fail' },
      ...[
        t.task_id,
        taskKind(t),
        t.mode,
        fmtN(t.N),
        t.k,
        t.model,
        t.metrics.success
          ? 'PASS'
          : `${t.failure_type ?? 'error'}` +
            `${(t.metrics.parts_total ?? 1) > 1 ? ` (${t.metrics.parts_done}/${t.metrics.parts_total})` : ''}`,
        t.metrics.steps,
        t.usage.llm_calls +
          (t.usage.query_agent_llm_calls ? `+${t.usage.query_agent_llm_calls}` : ''),
        fmtNum(t.usage.input_tokens),
        (t.latency_ms / 1000).toFixed(1),
      ].map((v) => el('td', {}, String(v))),
    );
    tr.addEventListener('click', () => {
      history.replaceState(null, '', `#t-${t.trial_key}`);
      renderTrial(t);
      document
        .querySelectorAll('#trials tr.selected')
        .forEach((r) => r.classList.remove('selected'));
      tr.classList.add('selected');
    });
    return tr;
  });
  $('#trials').replaceChildren(
    el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))),
    el('tbody', {}, ...body),
  );
}

const toolName = (id: string | null) => id ?? '?';
function renderTrial(t: TrialRecord) {
  const targets = targetsOf(t);
  const isTarget = (id: string | null) => id !== null && targets.includes(id);
  const json = (v: unknown) =>
    el('details', {}, el('summary', {}, 'json'), el('pre', {}, JSON.stringify(v, null, 2)));
  const hitList = (hits: { tool_id: string; score: number }[]) =>
    el(
      'ol',
      { class: 'hits' },
      ...hits.map((h) =>
        el(
          'li',
          { class: isTarget(h.tool_id) ? 'target' : '' },
          `${h.score.toFixed(3)}  ${nameOf(t, h.tool_id)}${isTarget(h.tool_id) ? '  ◀ target' : ''}`,
        ),
      ),
    );
  const row = (e: TraceEvent): HTMLElement => {
    switch (e.type) {
      case 'llm_call':
        return el(
          'div',
          { class: 'ev llm' },
          el('b', {}, `step ${e.step} · ${e.agent}`),
          ` ${e.model} · ${(e.latency_ms / 1000).toFixed(1)}s · in ${e.input_tokens} · tools ${e.n_tools}`,
          e.text ? el('div', { class: 'quote' }, e.text) : '',
        );
      case 'search':
        return el(
          'div',
          { class: 'ev search' },
          el('b', {}, e.agent === 'query_agent' ? 'search_tools' : 'search'),
          ` "${e.query}"${e.filters ? ' ' + JSON.stringify(e.filters) : ''} · N=${e.N} k=${e.k} · ${e.latency_ms}ms`,
          hitList(e.hits),
          e.hits.some((h) => isTarget(h.tool_id))
            ? ''
            : el('div', { class: 'warn' }, 'no target in this search'),
        );
      case 'retrieval':
        return el(
          'div',
          { class: 'ev retrieval' },
          el('b', {}, 'delivered to worker'),
          ` for "${e.need}"`,
          hitList(e.hits),
          e.hits.some((h) => isTarget(h.tool_id))
            ? ''
            : el('div', { class: 'warn' }, 'no target delivered'),
        );
      case 'tool_call':
        return el(
          'div',
          { class: `ev call ${e.tool_id === null ? 'bad' : e.valid ? 'ok' : 'bad'}` },
          el('b', {}, e.tool_name),
          isTarget(e.tool_id) ? ' ◀ target' : '',
          ` · ${e.tool_id === null ? 'UNKNOWN TOOL' : e.valid ? 'valid' : 'invalid args'}`,
          json({ args: e.args, response: e.response }),
        );
      case 'finish':
        return el(
          'div',
          { class: 'ev finish' },
          el('b', {}, `finish(${e.status})`),
          ` ${e.summary}`,
        );
      case 'note':
        return el('div', { class: 'ev' }, e.text);
    }
  };
  $('#detail').replaceChildren(
    el('h3', {}, `${t.task_id} · ${t.metrics.success ? 'PASS' : `FAIL (${t.failure_type})`}`),
    el('div', { class: 'quote' }, promptOf(t)),
    el(
      'div',
      { class: 'muted' },
      `${taskKind(t)} · target ${targets.map((id) => nameOf(t, id)).join(' → ')}` +
        `${t.confusers ? ` · look-alikes ${t.confusers.same_action} (same vendor ${t.confusers.same_vendor})` : ''}` +
        ` · ${t.mode} · N=${t.N} k=${t.k}` +
        ` · ${t.model}${t.qa_model ? ` / qa ${t.qa_model}` : ''}` +
        `${t.error ? ` · error: ${t.error}` : ''}`,
    ),
    ...t.events.map(row),
  );
  $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// tool names for search hits come from a side table (tool_id → name) embedded with the data
const SIDE = JSON.parse($('#side').textContent!) as { names: Record<string, string> };
const promptOf = (t: TrialRecord) => t.task.prompt;
const nameOf = (_t: TrialRecord, id: string) => SIDE.names[id] ?? toolName(id);

function renderAll() {
  renderTiles();
  renderCharts();
  renderCellTable();
  renderBreakdowns();
}

$('#meta').textContent = `${trials.length} trials · generated ${DATA.generated}`;
renderFilters();
renderAll();
renderTrialTable();
const params = new URLSearchParams(location.search);
const theme = params.get('theme'); // ?theme=light|dark overrides the OS setting (also handy for screenshots)
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
// deep link to a trial: #t-<trial_key> (a plain hash works both locally and when hosted)
const linked = /^#t-([0-9a-f]+)$/.exec(location.hash)?.[1] ?? params.get('trial');
const linkedTrial = linked && trials.find((t) => t.trial_key === linked);
if (linkedTrial) renderTrial(linkedTrial);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);

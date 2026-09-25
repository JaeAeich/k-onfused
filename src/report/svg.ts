/**
 * Static SVG charts for the results write-up: no script, so they render on GitHub, in a PDF, or in an image
 * viewer. Same validated palette as report.html; light/dark via prefers-color-scheme inside the SVG. Every
 * chart is paired with a table of the same numbers in the markdown (some slots are below 3:1 contrast).
 */
const LIGHT = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
];
const DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];
/** slot index, or 'neutral' for a de-emphasized category (e.g. PASS in an outcome mix) */
export type Slot = number | 'neutral';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (p: number) => `${Math.round(p * 100)}%`;
const cls = (s: Slot) => (s === 'neutral' ? 'n' : `s${s}`);

function style(): string {
  const slots = (pal: string[]) =>
    pal.map((c, i) => `.s${i}{fill:${c};stroke:${c}} .t${i}{stroke:${c}}`).join(' ');
  return `<style>
svg{font:12px system-ui,-apple-system,"Segoe UI",sans-serif}
.bg{fill:#fcfcfb} .ink{fill:#0b0b0b} .ink2{fill:#52514e} .muted{fill:#898781}
.grid{stroke:#e1e0d9;stroke-width:1} .axis{stroke:#c3c2b7;stroke-width:1}
.n{fill:#d8d7d0;stroke:#d8d7d0} ${slots(LIGHT)} .ring{stroke:#fcfcfb}
@media (prefers-color-scheme: dark){
.bg{fill:#1a1a19} .ink{fill:#fff} .ink2{fill:#c3c2b7} .grid{stroke:#2c2c2a} .axis{stroke:#383835}
.n{fill:#3a3a37;stroke:#3a3a37} ${slots(DARK)} .ring{stroke:#1a1a19}}
</style>`;
}

const frame = (w: number, h: number, title: string, subtitle: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ` +
  `role="img" aria-label="${esc(title)}">
${style()}
<rect class="bg" width="${w}" height="${h}" rx="10"/>
<text class="ink" x="16" y="26" font-size="14" font-weight="600">${esc(title)}</text>
${subtitle ? `<text class="muted" x="16" y="44">${esc(subtitle)}</text>` : ''}
${body}
</svg>
`;

/** Legend row: swatch + name per entry, wrapping at `maxX`. Returns markup and the y below it. */
function legend(items: { name: string; slot: Slot }[], x0: number, y0: number, maxX: number) {
  let x = x0,
    y = y0;
  const out: string[] = [];
  for (const it of items) {
    const w = 18 + it.name.length * 6.2 + 18;
    if (x + w > maxX && x > x0) {
      x = x0;
      y += 18;
    }
    out.push(
      `<rect class="${cls(it.slot)}" x="${x}" y="${y - 9}" width="10" height="10" rx="2"/>` +
        `<text class="ink2" x="${x + 16}" y="${y}">${esc(it.name)}</text>`,
    );
    x += w;
  }
  return { svg: out.join(''), bottom: y + 12 };
}

export interface LinePoint {
  x: string;
  y: number;
  lo: number;
  hi: number;
  n: number;
}
export interface LineSeries {
  name: string;
  slot: number;
  points: LinePoint[];
}

/** Rate (0–1) vs a categorical x, one line per series, 95% CI whiskers, direct labels at the right end. */
export function lineChartSvg(o: {
  title: string;
  subtitle?: string;
  xLabel: string;
  xs: string[];
  series: LineSeries[];
}): string {
  const W = 680,
    H = 380;
  const lg = legend(
    o.series.map((s) => ({ name: s.name, slot: s.slot })),
    16,
    o.subtitle ? 68 : 52,
    W - 16,
  );
  const L = 52,
    R = 110,
    T = lg.bottom + 14,
    B = 52;
  const pw = W - L - R,
    ph = H - T - B;
  const xAt = (i: number) =>
    L + (o.xs.length === 1 ? pw / 2 : (i / (o.xs.length - 1)) * pw * 0.9 + pw * 0.05);
  const yAt = (v: number) => T + ph - v * ph;
  const parts: string[] = [lg.svg];
  for (const g of [0, 0.25, 0.5, 0.75, 1])
    parts.push(
      `<line class="${g === 0 ? 'axis' : 'grid'}" x1="${L}" x2="${L + pw}" y1="${yAt(g)}" y2="${yAt(g)}"/>`,
      `<text class="muted" x="${L - 8}" y="${yAt(g) + 4}" text-anchor="end">${pct(g)}</text>`,
    );
  o.xs.forEach((x, i) =>
    parts.push(
      `<text class="muted" x="${xAt(i)}" y="${T + ph + 18}" text-anchor="middle">${esc(x)}</text>`,
    ),
  );
  parts.push(
    `<text class="ink2" x="${L + pw / 2}" y="${H - 12}" text-anchor="middle">${esc(o.xLabel)}</text>`,
  );

  // dodge whiskers/markers of different series sideways so CIs don't hide each other
  const dodge = (si: number) => (si - (o.series.length - 1) / 2) * 8;
  const ends: { y: number; text: string; slot: number }[] = [];
  o.series.forEach((s, si) => {
    const pts = s.points
      .map((p) => ({ ...p, i: o.xs.indexOf(p.x) }))
      .filter((p) => p.i >= 0 && !Number.isNaN(p.y))
      .sort((a, b) => a.i - b.i);
    if (!pts.length) return;
    const X = (p: { i: number }) => xAt(p.i) + dodge(si);
    for (const p of pts)
      parts.push(
        `<line class="t${s.slot}" stroke-width="1.5" opacity=".7" ` +
          `x1="${X(p)}" x2="${X(p)}" y1="${yAt(p.lo)}" y2="${yAt(p.hi)}"/>`,
      );
    parts.push(
      `<polyline class="t${s.slot}" fill="none" stroke-width="2" stroke-linejoin="round" ` +
        `points="${pts.map((p) => `${X(p)},${yAt(p.y)}`).join(' ')}"/>`,
    );
    for (const p of pts)
      parts.push(
        `<circle class="s${s.slot} ring" style="stroke-width:2" cx="${X(p)}" cy="${yAt(p.y)}" r="4.5">` +
          `<title>${esc(`${s.name} · ${p.x}: ${pct(p.y)} (95% CI ${pct(p.lo)}–${pct(p.hi)}, n=${p.n})`)}` +
          `</title></circle>`,
      );
    const last = pts[pts.length - 1]!;
    ends.push({ y: yAt(last.y), text: `${s.name} ${pct(last.y)}`, slot: s.slot });
  });
  // direct labels: keep ≥14px apart
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i]!.y = Math.max(ends[i]!.y, ends[i - 1]!.y + 14);
  const lx = xAt(o.xs.length - 1) + 16;
  for (const e of ends)
    parts.push(
      `<rect class="s${e.slot}" x="${lx}" y="${e.y - 5}" width="8" height="8" rx="2"/>` +
        `<text class="ink" x="${lx + 12}" y="${e.y + 3}">${esc(e.text)}</text>`,
    );
  return frame(W, H, o.title, o.subtitle ?? '', parts.join('\n'));
}

/** One horizontal 100% bar per row, segmented by category counts (outcome mix). */
export function stackedBarsSvg(o: {
  title: string;
  subtitle?: string;
  categories: { name: string; slot: Slot }[];
  rows: { label: string; counts: number[] }[];
}): string {
  const W = 680;
  const lg = legend(o.categories, 16, o.subtitle ? 68 : 52, W - 16);
  const L = 130,
    R = 56,
    T = lg.bottom + 10,
    rowH = 26,
    barH = 16;
  const H = T + o.rows.length * rowH + 16;
  const pw = W - L - R;
  const parts: string[] = [lg.svg];
  o.rows.forEach((row, ri) => {
    const y = T + ri * rowH;
    const n = row.counts.reduce((a, b) => a + b, 0);
    parts.push(
      `<text class="ink2" x="${L - 10}" y="${y + barH / 2 + 4}" text-anchor="end">${esc(row.label)}</text>`,
    );
    let x = L;
    row.counts.forEach((c, ci) => {
      if (!c) return;
      const w = (c / n) * pw;
      const cat = o.categories[ci]!;
      // 2px surface gap between segments
      parts.push(
        `<rect class="${cls(cat.slot)}" x="${x}" y="${y}" width="${Math.max(1, w - 2)}" ` +
          `height="${barH}" rx="3"><title>${esc(`${row.label} · ${cat.name}: ${c}/${n}`)}</title></rect>`,
      );
      x += w;
    });
    parts.push(`<text class="muted" x="${L + pw + 8}" y="${y + barH / 2 + 4}">n=${n}</text>`);
  });
  return frame(W, H, o.title, o.subtitle ?? '', parts.join('\n'));
}

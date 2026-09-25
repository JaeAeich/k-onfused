import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactMcNemar } from '../src/report/writeup.js';
import { lineChartSvg } from '../src/report/svg.js';

test('exact McNemar: symmetric, 1 with no flips, small p only for lopsided flips', () => {
  assert.equal(exactMcNemar(0, 0), 1);
  assert.equal(exactMcNemar(3, 3), 1);
  assert.equal(exactMcNemar(5, 1), exactMcNemar(1, 5));
  // 8 flips all one way: 2 * 0.5^8
  assert.ok(Math.abs(exactMcNemar(8, 0) - 2 / 256) < 1e-12);
  assert.ok(exactMcNemar(6, 1) > 0.05 && exactMcNemar(6, 1) < 0.2);
});

test('line chart SVG: one polyline per series, escaped text, no NaN coordinates', () => {
  const svg = lineChartSvg({
    title: 'a < b',
    xLabel: 'N',
    xs: ['100', '10k'],
    series: [
      {
        name: 'k=3',
        slot: 0,
        points: [
          { x: '100', y: 0.5, lo: 0.2, hi: 0.8, n: 10 },
          { x: '10k', y: NaN, lo: NaN, hi: NaN, n: 0 },
        ],
      },
      { name: 'k=10', slot: 1, points: [{ x: '100', y: 1, lo: 0.7, hi: 1, n: 10 }] },
    ],
  });
  assert.equal((svg.match(/<polyline/g) ?? []).length, 2);
  assert.ok(svg.includes('a &lt; b'));
  assert.ok(!svg.includes('NaN'));
});

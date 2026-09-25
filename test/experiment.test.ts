import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pacer, expandSweep } from '../src/experiment.js';

test('expandSweep order and keys', () => {
  const specs = expandSweep({
    Ns: [100, 1000],
    ks: [3, 10],
    modes: ['direct'],
    taskIds: ['t001', 't002'],
    repeats: 2,
    backend: 'claude-code',
    model: 'haiku',
    runId: 'r',
    seed: 1,
  });
  assert.equal(specs.length, 2 * 2 * 2 * 2);
  assert.deepEqual(
    specs.slice(0, 3).map((s) => [s.repeat, s.taskId, s.N, s.k]),
    [
      [0, 't001', 100, 3],
      [0, 't001', 100, 10],
      [0, 't001', 1000, 3],
    ],
  );
  assert.equal(new Set(specs.map((s) => s.key)).size, specs.length);
});

test('Pacer pauses on window pressure and on non-allowed status (not on warnings), never beyond 6h', async () => {
  const log: string[] = [];
  let slept = 0;
  const clock = 1_000_000_000_000;
  const pacer = new Pacer(
    (s) => log.push(s),
    async (ms) => {
      slept += ms;
    },
    () => clock,
  );
  pacer.observe(
    { status: 'allowed', five_hour: { utilization: 0.5, resets_at: clock / 1000 + 3600 } },
    0.92,
  );
  pacer.observe(
    { status: 'allowed_warning', five_hour: { utilization: 0.25, resets_at: clock / 1000 + 3600 } },
    0.92,
  );
  await pacer.wait();
  assert.equal(slept, 0);
  pacer.observe(
    { status: 'allowed', five_hour: { utilization: 0.95, resets_at: clock / 1000 + 600 } },
    0.92,
  );
  await pacer.wait();
  assert.equal(slept, 600_000 + 30_000);
  pacer.observe(
    { status: 'rejected', five_hour: { utilization: 1, resets_at: clock / 1000 + 100_000 } },
    0.92,
  );
  await pacer.wait();
  assert.equal(slept, 630_000 + 6 * 3600_000);
  assert.equal(log.length, 2);
});

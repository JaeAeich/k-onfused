import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTools, sigKey, NAME_RE } from '../src/gen/tools.js';
import { generateTasks, assertDisjoint, TARGET_RANK } from '../src/gen/tasks.js';

test('tools are unique by name and signature, names valid, deterministic prefix', () => {
  const a = generateTools({ seed: 42, count: 300 });
  const b = generateTools({ seed: 42, count: 600 });
  const names = new Set<string>(),
    sigs = new Set<string>();
  for (const t of b.tools) {
    assert.match(t.name, NAME_RE);
    assert.ok(!names.has(t.name));
    names.add(t.name);
    assert.ok(!sigs.has(sigKey(t)));
    sigs.add(sigKey(t));
    assert.equal(t.input_schema.additionalProperties, false);
  }
  // prefix property: first 300 of the 600-run equal the 300-run
  assert.deepEqual(
    a.tools.map((t) => t.name),
    b.tools.slice(0, 300).map((t) => t.name),
  );
  assert.notDeepEqual(
    generateTools({ seed: 43, count: 50 }).tools.map((t) => t.name),
    a.tools.slice(0, 50).map((t) => t.name),
  );
});

test('ranks: targets TARGET_RANK, others a permutation of 0..; a trial catalog is exactly N', () => {
  const { tools } = generateTools({ seed: 42, count: 3000 });
  const tasks = generateTasks(tools, { seed: 7, count: 20, multi: 4 });
  const targets = new Set(tasks.flatMap((k) => k.target_tool_ids));
  assert.equal(targets.size, 28);
  for (const t of tools) assert.equal(t.rank === TARGET_RANK, targets.has(t.tool_id));
  assert.deepEqual(
    tools
      .map((t) => t.rank)
      .filter((r) => r !== TARGET_RANK)
      .sort((x, y) => x - y),
    Array.from({ length: 2972 }, (_, i) => i),
  );
  // what ToolIndex.search keeps: own targets + rank < N - |own targets|; no other task's target
  for (const task of tasks)
    for (const N of [50, 100, 2500]) {
      const pinned = new Set(task.target_tool_ids);
      const cat = tools.filter((t) => pinned.has(t.tool_id) || t.rank < N - pinned.size);
      assert.equal(cat.length, N);
      assert.ok(cat.every((t) => pinned.has(t.tool_id) || !targets.has(t.tool_id)));
    }
});

test('single-step tasks do not change when multi-step tasks are added', () => {
  const a = generateTasks(generateTools({ seed: 42, count: 2000 }).tools, { seed: 7, count: 10 });
  const b = generateTasks(generateTools({ seed: 42, count: 2000 }).tools, {
    seed: 7,
    count: 10,
    multi: 6,
  });
  assert.deepEqual(a, b.slice(0, 10));
});

test('multi-step tasks: two targets, every required arg constrained, chain refs step 1', () => {
  const { tools } = generateTools({ seed: 42, count: 5000 });
  const tasks = generateTasks(tools, { seed: 7, count: 10, multi: 20 }).filter(
    (k) => k.tags.multi_step,
  );
  const byId = new Map(tools.map((t) => [t.tool_id, t]));
  assert.equal(tasks.length, 20);
  for (const k of tasks) {
    assert.equal(k.expected_calls.length, 2);
    const [a, b] = k.target_tool_ids.map((id) => byId.get(id)!);
    assertDisjoint(k.prompt, a!);
    assertDisjoint(k.prompt, b!);
    k.expected_calls.forEach((x, i) => {
      const t = byId.get(x.tool_id)!;
      for (const r of t.input_schema.required as string[])
        assert.ok(
          Object.keys(x.args).some((p) => p === r || p.startsWith(r + '.')),
          `${r} unconstrained in ${k.task_id} step ${i + 1}`,
        );
    });
    if (k.tags.cross_app) assert.notEqual(a!.category, b!.category);
    else {
      assert.ok(['create', 'send', 'invite'].includes(a!.action)); // create-mode actions return a new id
      assert.equal(a!.app, b!.app);
      assert.ok(Object.values(k.expected_calls[1]!.args).some((c) => 'ref' in c && c.ref === 0));
    }
  }
  assert.equal(tasks.filter((k) => k.tags.cross_app).length, 10);
});

test('task prompts avoid tool names and description wording; each task has one target', () => {
  const { tools } = generateTools({ seed: 42, count: 1000 });
  const tasks = generateTasks(tools, { seed: 7, count: 100 });
  const byId = new Map(tools.map((t) => [t.tool_id, t]));
  for (const k of tasks) {
    assert.equal(k.target_tool_ids.length, 1);
    const t = byId.get(k.target_tool_ids[0]!)!;
    assertDisjoint(k.prompt, t); // throws on violation
    assert.ok(Object.keys(k.expected_calls[0]!.args).length >= 1);
    // every required arg is constrained
    for (const r of t.input_schema.required as string[])
      assert.ok(
        Object.keys(k.expected_calls[0]!.args).some((p) => p === r || p.startsWith(r + '.')),
        `${r} unconstrained in ${k.task_id}`,
      );
  }
});

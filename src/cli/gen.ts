import { Command } from 'commander';
import { config } from '../config.js';
import { GEN_VERSION } from '../gen/vocab.js';
import { generateTools, stripGen } from '../gen/tools.js';
import { generateTasks } from '../gen/tasks.js';
import { toolsFile, tasksFile, writeJsonl } from '../data.js';

const prog = new Command()
  .option('--count <n>', 'number of tools', String(1000))
  .option('--tasks <n>', 'number of single-step tasks', String(10))
  .option('--multi <n>', 'number of two-step tasks (alternating chain / cross_app)', String(0))
  .option('--seed <n>', 'generator seed', String(config.seeds.gen))
  .option('--task-seed <n>', 'task seed', String(config.seeds.task))
  .option('--quiet', 'no samples')
  .parse();
const o = prog.opts();
const count = Number(o.count),
  nTasks = Number(o.tasks),
  seed = Number(o.seed),
  taskSeed = Number(o.taskSeed);

const t0 = Date.now();
const { tools, universeSize } = generateTools({ seed, count });
const tasks = generateTasks(tools, { seed: taskSeed, count: nTasks, multi: Number(o.multi) });
writeJsonl(
  toolsFile(),
  { _header: true, gen_version: GEN_VERSION, seed, count, universe_size: universeSize },
  tools.map(stripGen),
);
writeJsonl(
  tasksFile(),
  { _header: true, gen_version: GEN_VERSION, seed, count: tasks.length, task_seed: taskSeed },
  tasks,
);

console.log(
  `gen ${GEN_VERSION}: ${tools.length} tools (universe ${universeSize}),` +
    ` ${tasks.length} tasks in ${Date.now() - t0}ms` +
    ` → ${toolsFile()}, ${tasksFile()}`,
);
if (!o.quiet) {
  for (const t of tools.slice(0, 3))
    console.log(
      `\n[${t.tool_id}] ${t.name}\n  ${t.description}\n  required: ${(t.input_schema.required as string[]).join(', ')}`,
    );
  const multi = tasks.filter((k) => k.tags.multi_step);
  for (const k of [...tasks.slice(0, 3), ...multi.slice(0, 4)]) {
    const kind = k.tags.multi_step ? (k.tags.cross_app ? ' [cross_app]' : ' [chain]') : '';
    const steps = k.expected_calls.map(
      (x) => `  → ${tools.find((t) => t.tool_id === x.tool_id)!.name} ${JSON.stringify(x.args)}`,
    );
    console.log(`\n${k.task_id}${kind}\n  "${k.prompt}"\n${steps.join('\n')}`);
  }
}

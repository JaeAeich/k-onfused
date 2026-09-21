import { Command } from 'commander';
import { collectionName } from '../config.js';
import { readTasks, readTools } from '../data.js';
import { Embedder, toolEmbedText } from '../index/embed.js';
import { ToolIndex } from '../index/qdrant.js';

const o = new Command()
  .option('--ranks-only', 'only rewrite rank payloads (no embedding)')
  .option(
    '--check',
    'after indexing, search each task prompt at N=all,k=10 and report the target ranks',
  )
  .parse()
  .opts();

const { header, rows: tools } = readTools();
const index = new ToolIndex(collectionName(header.gen_version));
const embedder = new Embedder();
const t0 = Date.now();

const created = await index.ensure();
console.log(
  `collection ${index.collection} ${created ? 'created' : 'exists'}` +
    ` (${await index.count()} points); ${tools.length} tools to index`,
);

if (o.ranksOnly) {
  await index.setRanks(tools);
} else {
  const vectors = await embedder.embedAll(tools.map(toolEmbedText), (d, n) =>
    process.stdout.write(`\r  embedding ${d}/${n}`),
  );
  process.stdout.write('\n');
  await index.upsertTools(tools, vectors);
}
console.log(`indexed → ${await index.count()} points in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

if (o.check) {
  const { rows: tasks } = readTasks();
  const byId = new Map(tools.map((t) => [t.tool_id, t]));
  console.log('\nretrieval sanity (N=all, k=10):');
  for (const task of tasks) {
    const cat = { N: tools.length, pinned: task.target_tool_ids };
    const hits = await index.search(await embedder.embedQuery(task.prompt), cat, 10);
    const top = byId.get(hits[0]!.tool_id)!.name;
    const at = task.target_tool_ids.map((id) => {
      const pos = hits.findIndex((h) => h.tool_id === id);
      return `${pos < 0 ? 'miss' : pos + 1}${pos !== 0 ? ` (${byId.get(id)!.name})` : ''}`;
    });
    console.log(`  ${task.task_id} target@${at.join(' + ')}  top=${top}`);
  }
}

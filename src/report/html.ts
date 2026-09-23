import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { ToolDef, TrialRecord } from '../types.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);

/** Transpile a browser-safe TS file to plain JS and strip module syntax so several files share one scope. */
function inlineModule(file: string): string {
  const src = fs.readFileSync(path.join(HERE, file), 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return out
    .split('\n')
    .filter((l) => !/^import\b/.test(l))
    .map((l) => l.replace(/^export\s+(const|function|class|let)\b/, '$1'))
    .join('\n');
}

const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

const CSS = fs.readFileSync(path.join(HERE, 'report.css'), 'utf8');

/**
 * @param fragment  omit the <!doctype>/<html>/<head>/<body> wrapper (for hosts that supply their own,
 *                  e.g. publishing as a claude.ai artifact); the <title> and <style> stay at the top.
 */
export function buildReportHtml(trials: TrialRecord[], tools: ToolDef[], fragment = false): string {
  // only the tools that appear in some trial's events need a name in the page (the catalog may be 200k)
  const referenced = new Set<string>();
  for (const t of trials) {
    for (const id of t.task.target_tool_ids ?? [t.task.target_tool_id]) referenced.add(id);
    for (const e of t.events) {
      if (e.type === 'search' || e.type === 'retrieval')
        for (const h of e.hits) referenced.add(h.tool_id);
      if (e.type === 'tool_call' && e.tool_id) referenced.add(e.tool_id);
    }
  }
  const side = {
    names: Object.fromEntries(
      tools.filter((t) => referenced.has(t.tool_id)).map((t) => [t.tool_id, t.name]),
    ),
  };
  const script = [inlineModule('stats.ts'), inlineModule('render.ts')].join('\n');
  const head = fragment
    ? `<title>ToolScale Results</title>\n<style>${CSS}</style>`
    : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ToolScale Results</title>
<style>${CSS}</style>
</head>
<body>`;
  return `${head}
<main>
  <h1>ToolScale — how agents break as tool catalogs grow</h1>
  <div id="meta" class="muted"></div>
  <div id="filters"></div>
  <div id="tiles"></div>
  <h2>Curves (one line per catalog size N)</h2>
  <div id="charts"></div>
  <h2>Retrieval modes compared</h2>
  <div id="mode-chart"></div>
  <h2>All cells</h2>
  <div class="table-wrap"><table id="cells"></table></div>
  <h2>Breakdowns (this backend / model / mode, all N and k pooled)</h2>
  <div id="breakdowns"></div>
  <h2>Trials</h2>
  <div id="trial-filters"></div>
  <div class="table-wrap"><table id="trials"></table></div>
  <div id="story">
    <span class="muted">Click a trial to see its story: what the worker asked for, what was searched,
    what came back, what got called, and why it failed.</span>
  </div>
</main>
<script id="data" type="application/json">${jsonForScript({ generated: new Date().toISOString(), trials })}</script>
<script id="side" type="application/json">${jsonForScript(side)}</script>
<script type="module">
${script}
</script>${fragment ? '' : '\n</body>\n</html>'}`;
}

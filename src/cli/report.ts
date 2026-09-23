import fs from 'node:fs';
import { Command } from 'commander';
import { readTools } from '../data.js';
import { RESULTS_FILE, readResults } from '../results.js';
import { buildReportHtml } from '../report/html.js';

const o = new Command()
  .option('--in <file>', 'results JSONL', RESULTS_FILE)
  .option('--out <file>', 'output HTML', 'report.html')
  .option('--fragment', 'no <html>/<head>/<body> wrapper (for hosts that add their own)')
  .parse()
  .opts();

const trials = readResults(o.in);
if (!trials.length) throw new Error(`no trials in ${o.in}`);
const html = buildReportHtml(trials, readTools().rows, Boolean(o.fragment));
fs.writeFileSync(o.out, html);
console.log(`report: ${trials.length} trials → ${o.out} (${(html.length / 1024).toFixed(0)} KB)`);

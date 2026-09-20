/** JSONL files under data/: a header line (gen_version, seed, count) followed by one record per line. */
import fs from 'node:fs';
import path from 'node:path';
import type { Task, ToolDef } from './types.js';
import { config } from './config.js';

export interface Header {
  _header: true;
  gen_version: string;
  seed: number;
  count: number;
  universe_size?: number;
  task_seed?: number;
}

export function writeJsonl(file: string, header: Header, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const out = fs.createWriteStream(file);
  out.write(JSON.stringify(header) + '\n');
  for (const r of rows) out.write(JSON.stringify(r) + '\n');
  out.end();
}

function readJsonl<T>(file: string): { header: Header; rows: T[] } {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const header = JSON.parse(lines[0]!) as Header;
  if (!header._header) throw new Error(`${file}: missing header line`);
  return { header, rows: lines.slice(1).map((l) => JSON.parse(l) as T) };
}

export const toolsFile = () => path.join(config.dataDir, 'tools.jsonl');
export const tasksFile = () => path.join(config.dataDir, 'tasks.jsonl');
export const readTools = () => readJsonl<ToolDef>(toolsFile());
export const readTasks = () => readJsonl<Task>(tasksFile());

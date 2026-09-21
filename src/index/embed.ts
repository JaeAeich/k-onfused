import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { config } from '../config.js';

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

/**
 * In-process embedder with an append-only on-disk cache:
 *   data/emb_<tag>.bin  — Float32 rows, dim floats each
 *   data/emb_<tag>.idx  — one sha1(text) per line, line i ↔ row i
 * Re-indexing after a rank change or a vocab tweak only embeds new texts.
 */
export class Embedder {
  private pipe: FeatureExtractionPipeline | null = null;
  private cache = new Map<string, number>();
  private binPath: string;
  private idxPath: string;
  readonly dim = config.embedDim;

  constructor(private batchSize = 64) {
    this.binPath = path.join(config.dataDir, `emb_${config.embedTag}.bin`);
    this.idxPath = path.join(config.dataDir, `emb_${config.embedTag}.idx`);
    if (fs.existsSync(this.idxPath)) {
      fs.readFileSync(this.idxPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .forEach((h, i) => this.cache.set(h, i));
    }
  }

  private async model(): Promise<FeatureExtractionPipeline> {
    if (!this.pipe)
      this.pipe = await pipeline('feature-extraction', config.embedModel, { dtype: 'fp32' });
    return this.pipe;
  }

  private readRow(row: number): number[] {
    const fd = fs.openSync(this.binPath, 'r');
    const buf = Buffer.alloc(this.dim * 4);
    fs.readSync(fd, buf, 0, buf.length, row * this.dim * 4);
    fs.closeSync(fd);
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, this.dim));
  }

  private queue: Promise<unknown> = Promise.resolve();

  /** Run `fn` after every previously queued model call (concurrent trials share one pipeline). */
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Embed without touching the cache (queries). */
  embedQuery(text: string): Promise<number[]> {
    return this.serialized(async () => {
      const m = await this.model();
      const out = await m([text], { pooling: 'mean', normalize: true });
      return (out.tolist() as number[][])[0]!;
    });
  }

  /** Embed many texts, using and extending the disk cache. Order preserved. */
  async embedAll(
    texts: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number[][]> {
    const result: (number[] | null)[] = texts.map(() => null);
    const missing: number[] = [];
    const hashes = texts.map(sha1);
    for (let i = 0; i < texts.length; i++) {
      const row = this.cache.get(hashes[i]!);
      if (row !== undefined) result[i] = this.readRow(row);
      else missing.push(i);
    }
    if (missing.length) {
      fs.mkdirSync(config.dataDir, { recursive: true });
      const m = await this.model();
      const bin = fs.openSync(this.binPath, 'a');
      const idx = fs.openSync(this.idxPath, 'a');
      let row = this.cache.size;
      for (let b = 0; b < missing.length; b += this.batchSize) {
        const ids = missing.slice(b, b + this.batchSize);
        const out = await m(
          ids.map((i) => texts[i]!),
          { pooling: 'mean', normalize: true },
        );
        const vecs = out.tolist() as number[][];
        for (let j = 0; j < ids.length; j++) {
          const v = vecs[j]!;
          const i = ids[j]!;
          if (v.length !== this.dim) throw new Error(`embedding dim ${v.length} != ${this.dim}`);
          result[i] = v;
          const h = hashes[i]!;
          if (!this.cache.has(h)) {
            fs.writeSync(bin, Buffer.from(new Float32Array(v).buffer));
            fs.writeSync(idx, h + '\n');
            this.cache.set(h, row++);
          }
        }
        onProgress?.(Math.min(b + this.batchSize, missing.length), missing.length);
      }
      fs.closeSync(bin);
      fs.closeSync(idx);
    }
    return result as number[][];
  }
}

export const toolEmbedText = (t: { name: string; description: string }) =>
  `${t.name.replace(/_/g, ' ')}: ${t.description}`;

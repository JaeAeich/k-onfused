import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';

/** Local cross-encoders we compare (all run in-process on CPU; no API). */
export const RERANKERS = {
  minilm: { id: 'Xenova/ms-marco-MiniLM-L-6-v2', dtype: 'fp32' },
  'bge-base': { id: 'Xenova/bge-reranker-base', dtype: 'fp32' },
  'bge-m3': { id: 'onnx-community/bge-reranker-v2-m3-ONNX', dtype: 'q8' },
} as const;
export type RerankerName = keyof typeof RERANKERS;

/**
 * "System 1" re-ranker: a cross-encoder reads (query, tool text) together and returns one relevance
 * logit per pair, in a single forward pass. Used to re-order the top candidates of the vector search.
 */
export class Reranker {
  private loaded: Promise<{ tok: PreTrainedTokenizer; model: PreTrainedModel }> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly name: RerankerName,
    private batchSize = 25,
  ) {}

  private load() {
    const spec = RERANKERS[this.name];
    this.loaded ??= Promise.all([
      AutoTokenizer.from_pretrained(spec.id),
      AutoModelForSequenceClassification.from_pretrained(spec.id, { dtype: spec.dtype }),
    ]).then(([tok, model]) => ({ tok, model }));
    return this.loaded;
  }

  /** Relevance score per doc (higher = better), same order as `docs`. Calls are serialized. */
  score(query: string, docs: string[]): Promise<number[]> {
    const run = async () => {
      const { tok, model } = await this.load();
      const out: number[] = [];
      for (let b = 0; b < docs.length; b += this.batchSize) {
        const batch = docs.slice(b, b + this.batchSize);
        const inputs = tok(
          batch.map(() => query),
          { text_pair: batch, padding: true, truncation: true, max_length: 256 },
        );
        const { logits } = await model(inputs);
        out.push(...(logits.tolist() as number[][]).map((row) => row[0]!));
      }
      return out;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

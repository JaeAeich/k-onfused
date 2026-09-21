/**
 * Qdrant wrapper. One collection per (gen_version, embedding model). Catalog size is never a separate
 * index: every search keeps the trial's own targets (pinned by point id) plus `rank < N - pinned`.
 * Task targets carry TARGET_RANK, so other tasks' targets are never in the catalog.
 */
import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config.js';
import type { Catalog, RetrievalHit, ToolDef } from '../types.js';

/** Payload fields a search may filter on (exact match). */
export type SearchFilters = Partial<Record<'app' | 'resource' | 'action', string>>;

export interface ToolPayload {
  tool_id: string;
  name: string;
  app: string;
  resource: string;
  action: string;
  rank: number;
}

export class ToolIndex {
  readonly client = new QdrantClient({ url: config.qdrantUrl });
  constructor(readonly collection: string) {}

  /** Returns true if the collection was created. */
  async ensure(): Promise<boolean> {
    const { exists } = await this.client.collectionExists(this.collection);
    if (exists) return false;
    await this.client.createCollection(this.collection, {
      vectors: { size: config.embedDim, distance: 'Cosine' },
    });
    await this.client.createPayloadIndex(this.collection, {
      field_name: 'rank',
      field_schema: 'integer',
      wait: true,
    });
    return true;
  }

  async count(): Promise<number> {
    return (await this.client.count(this.collection, { exact: true })).count;
  }

  /** Point id = numeric part of tool_id, so re-upserts overwrite in place. */
  static pointId = (t: ToolDef) => Number(t.tool_id.slice(1));

  async upsertTools(tools: ToolDef[], vectors: number[][], batch = 256): Promise<void> {
    for (let i = 0; i < tools.length; i += batch) {
      const points = tools.slice(i, i + batch).map((t, j) => ({
        id: ToolIndex.pointId(t),
        vector: vectors[i + j]!,
        payload: {
          tool_id: t.tool_id,
          name: t.name,
          app: t.app,
          resource: t.resource,
          action: t.action,
          rank: t.rank,
        } satisfies ToolPayload,
      }));
      await this.client.upsert(this.collection, { wait: true, points });
    }
  }

  /** Rewrite only the rank payload (used when the task set changes; no re-embed). */
  async setRanks(tools: ToolDef[], batch = 500): Promise<void> {
    for (let i = 0; i < tools.length; i += batch) {
      await this.client.batchUpdate(this.collection, {
        wait: true,
        operations: tools.slice(i, i + batch).map((t) => ({
          set_payload: { payload: { rank: t.rank }, points: [ToolIndex.pointId(t)] },
        })),
      });
    }
  }

  /** Top-k over the simulated catalog of size N, optionally narrowed by payload filters. */
  async search(
    vector: number[],
    cat: Catalog,
    k: number,
    filters?: SearchFilters,
  ): Promise<RetrievalHit[]> {
    const others = { key: 'rank', range: { lt: cat.N - cat.pinned.length } };
    const must: Record<string, unknown>[] = [
      cat.pinned.length
        ? { should: [others, { has_id: cat.pinned.map((id) => Number(id.slice(1))) }] }
        : others,
    ];
    for (const [key, value] of Object.entries(filters ?? {})) {
      if (value) must.push({ key, match: { value } });
    }
    const res = await this.client.query(this.collection, {
      query: vector,
      limit: k,
      filter: { must },
      with_payload: ['tool_id'],
    });
    return res.points.map((p) => ({
      tool_id: String((p.payload as { tool_id: string }).tool_id),
      score: p.score,
    }));
  }
}

/**
 * Service Definition for the semantic memory capability seam (`ctx.memoryStore`): an abstract
 * service defining WHAT durable, model-visible memory does — retain a record, recall records by
 * relevance, and reflect on the store's contents — without saying HOW. Implementations subclass
 * {@link MemoryStore} and register as the `memoryStore` service; the SQLite backend in this
 * package is the default, and a pgvector-backed adapter is config-gated.
 *
 * The seam deliberately stays storage-agnostic: no vector dimension, no embedding model, no
 * retention policy. A backend may rank recall by embeddings when it has them (pgvector + an
 * `embed` function) and must otherwise fall back to lexical scoring, so an agent gets useful
 * recall on a zero-dependency SQLite backend out of the box.
 *
 * @module @atlasai/atsh-memory/service
 */

import { Context, Service } from '@deepseek-ai/cordis'

/**
 * Hard ceiling on the number of ranked matches {@link MemoryStore.recall} may return,
 * regardless of the caller's `limit`. Set to keep the fuzzy top-limit subset bounded; use
 * {@link MemoryStore.list} for the exhaustive, uncapped path. Both backends clamp
 * `opts.limit` to this value.
 */
export const RECALL_LIMIT_MAX = 50

import type {
  MemoryGetOptions,
  MemoryListOptions,
  MemoryQueryOptions,
  MemoryRecallResult,
  MemoryRecord,
  MemoryReflectOptions,
  MemoryRetainInput,
  MemorySummary,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memoryStore: MemoryStore
  }
}

/**
 * Abstract semantic memory service. Subclass, implement {@link recall}, {@link retain}, and
 * {@link reflect}, and load the subclass as a plugin — it registers as `ctx.memoryStore` (one
 * implementation per context; loading a second throws, cordis' standard duplicate-service
 * behavior).
 *
 * Semantics every implementation must honor:
 * - {@link retain} persists a record's FULL `content` verbatim and returns the stored record
 *   (id and timestamp assigned by the backend).
 * - {@link get} returns the single record in a namespace whose content matches `key` exactly
 *   (byte-identical), not a top-k ranked subset — the exact-recovery path.
 * - {@link recall} ranks stored content against the query and returns the best matches with a
 *   0..1 relevance `score`, ordered best-first, honoring `namespace` and `limit`.
 * - {@link reflect} reports totals, per-namespace counts, and the most recent records.
 */
export abstract class MemoryStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'memoryStore')
  }

  /**
   * Rank stored memories against `query` and return the best matches.
   * @param query - the model-facing search text; matched by token overlap (or embeddings, when the backend has them).
   * @param opts - optional namespace scope and result limit.
   * @returns matches ordered by relevance (0..1 score), best first, capped at the smaller of
   *   `opts.limit` (default 10) and {@link RECALL_LIMIT_MAX}. Returns a ranked top-limit subset
   *   that may be incomplete; use {@link list} or {@link reflect} for the full store.
   */
  abstract recall(query: string, opts?: MemoryQueryOptions): Promise<MemoryRecallResult[]>

  /**
   * Persist one memory record verbatim.
   * @param record - content to store, plus optional namespace and metadata.
   * @returns the stored record including the backend-assigned id and timestamp; rejects on a storage failure.
   */
  abstract retain(record: MemoryRetainInput): Promise<MemoryRecord>

  /**
   * Fetch the record whose content equals `key` byte-exactly within `opts.namespace`
   * (or the default namespace when omitted). Unlike {@link recall}, this is the exact path:
   * it returns the retained content verbatim, or `undefined` when no record matches exactly.
   * @param key - the exact content string to match, byte for byte.
   * @param opts - optional namespace scope.
   * @returns the single exact match, or `undefined` when none exists.
   */
  abstract get(key: string, opts?: MemoryGetOptions): Promise<MemoryRecord | undefined>

  /**
   * List ALL records from the store verbatim — the exhaustive counterpart to
   * {@link recall}'s ranked top-limit subset. Returns every stored record within
   * `opts.namespace` (or the whole store when omitted), newest first, with NO result
   * cap. Unlike {@link recall}, this is not a relevance-ranked sample: it gives the
   * complete, byte-exact contents of the store so an agent can recover every fact it
   * retained (the exact-recovery path).
   * @param opts - optional namespace scope.
   * @returns all matching records, newest first, no limit applied.
   */
  abstract list(opts?: MemoryListOptions): Promise<MemoryRecord[]>

  /**
   * Summarize the store: total records, per-namespace counts, and the most recent records.
   * @param opts - optional namespace scope and recent-count limit.
   * @returns the store summary.
   */
  abstract reflect(opts?: MemoryReflectOptions): Promise<MemorySummary>
}

export default MemoryStore

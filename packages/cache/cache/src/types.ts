/**
 * Canonical types for `@atlasai/atsh-cache`: cache configuration, the exact/semantic
 * hit vocabulary, the `cache/hit` / `cache/miss` event payloads, and the embedder
 * contract. Types only — no runtime code.
 * @module @atlasai/atsh-cache/types
 */

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A cached completion was served from the `llm_cache` table without an upstream
     * call. Fires once per hit, carrying the stored key and the tier that matched.
     * @param record - the hit: stored key, timestamp, and matching tier.
     * @mode emit
     */
    'cache/hit'(record: CacheHitRecord): void
    /**
     * A call missed the cache and was forwarded upstream; the completion will be
     * stored on success. Fires once per miss, before the stream is consumed.
     * @param record - the miss: request key and timestamp.
     * @mode emit
     */
    'cache/miss'(record: CacheMissRecord): void
  }
}

/** Configuration for the {@link LlmCache} service. */
export interface CacheConfig {
  /** Intercept the `llm/stream` waterfall. Defaults to `true`. */
  enabled?: boolean
  /**
   * Deterministic exact-hash tier: a byte-identical request (sha256 over a canonical
   * field subset) is served from the cache without an upstream call. Defaults to `true`.
   */
  exact?: boolean
  /**
   * Semantic embedding tier: a stored completion whose embedding scores at or above
   * `semanticThreshold` against the request is served as a near-match. Defaults to
   * `false` — gated because serving a near-match to a different prompt changes
   * model-visible content.
   */
  semantic?: boolean
  /**
   * Minimum cosine similarity for a semantic hit. Defaults to `0.9`.
   */
  semanticThreshold?: number
  /** SQLite cache-backend options. */
  sqlite?: {
    /** Database file path, or `':memory:'` (the default) for an in-process cache. */
    path?: string
  }
}

/** Which cache tier served a hit. */
export type CacheSource = 'exact' | 'semantic'

/**
 * One cache hit: the stored key served and the tier that matched it.
 */
export interface CacheHitRecord {
  /** Stored cache key (exact hash, or the stored key of the semantic match). */
  key: string
  /** Hit timestamp (epoch ms). */
  ts: number
  /** Tier that matched: `'exact'` or `'semantic'`. */
  source: CacheSource
}

/**
 * One cache miss: the request key forwarded upstream.
 */
export interface CacheMissRecord {
  /** Request cache key (exact hash). */
  key: string
  /** Miss timestamp (epoch ms). */
  ts: number
}

/**
 * Snapshot of the cache's table-level counters.
 */
export interface CacheStats {
  /** Rows in the `llm_cache` table. */
  entries: number
  /** Total hits served (sum of per-row hit counters). */
  hits: number
  /** Total misses (rows never served from cache). */
  misses: number
  /** `hits / (hits + misses)`, `0` when nothing has been served. */
  hitRate: number
}

/**
 * Maps a request's messages to a vector for the semantic tier. The default
 * implementation is a deterministic local bag-of-words embedder (see the service);
 * production deployments swap in a real embedding model via the public
 * `LlmCache.embedder` property.
 */
export type Embedder = (messages: unknown[]) => number[]

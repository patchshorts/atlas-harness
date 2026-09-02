/**
 * Shared types for the `@atlasai/atsh-memory` semantic memory seam. Types only —
 * no runtime code (repo convention).
 * @module @atlasai/atsh-memory/types
 */

/** One stored memory record. */
export interface MemoryRecord {
  /** Backend-assigned stable identifier. */
  id: string
  /** Namespace the record lives in; `''` is the default namespace. */
  namespace: string
  /** The verbatim retained content. */
  content: string
  /** Opaque structured metadata attached at retain time (JSON-serializable). */
  metadata: Record<string, unknown>
  /** Retention timestamp (ms since epoch). */
  createdAt: number
}

/** Input to {@link MemoryStore.retain}. */
export interface MemoryRetainInput {
  /** The content to persist verbatim. */
  content: string
  /** Namespace scope; omitted uses the default namespace. */
  namespace?: string
  /** Optional structured metadata (JSON-serializable). */
  metadata?: Record<string, unknown>
}

/** Options for {@link MemoryStore.recall}. */
export interface MemoryQueryOptions {
  /** Only match records in this namespace; omitted searches all namespaces. */
  namespace?: string
  /** Maximum number of results; default 10. */
  limit?: number
}

/** Options for {@link MemoryStore.get}. */
export interface MemoryGetOptions {
  /** Only match records in this namespace; omitted uses the default namespace. */
  namespace?: string
}

/** Options for {@link MemoryStore.list}. */
export interface MemoryListOptions {
  /** Only list records in this namespace; omitted lists the whole store. */
  namespace?: string
}

/** One ranked recall match. */
export interface MemoryRecallResult {
  id: string
  content: string
  namespace: string
  /** Relevance in [0, 1]; 1 = every query token matched. */
  score: number
}

/** Options for {@link MemoryStore.reflect}. */
export interface MemoryReflectOptions {
  /** Scope the summary to one namespace; omitted summarizes the whole store. */
  namespace?: string
  /** Number of most-recent records to include; default 10. */
  limit?: number
}

/** Store summary produced by {@link MemoryStore.reflect}. */
export interface MemorySummary {
  /** Total stored records (respecting the namespace scope). */
  total: number
  /** Count of records per namespace (respecting the namespace scope). */
  byNamespace: Record<string, number>
  /** The most recent records, newest first. */
  recent: MemoryRecord[]
}

/** Configuration for the SQLite backend. */
export interface SqliteConfig {
  /** Database file path, or `:memory:` for an in-process database; default `:memory:`. */
  path?: string
}

/** Configuration for the pgvector backend. */
export interface PgVectorConfig {
  /** PostgreSQL connection string (requires the operator to `pnpm add pg`). */
  connectionString: string
  /** Table name; default `memories`. Interpolated into SQL — only a trusted identifier. */
  table?: string
  /** Optional embedding function used to rank recall; without it recall falls back to lexical scoring. */
  embed?: (text: string) => number[] | Promise<number[]>
}

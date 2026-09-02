/**
 * `PgVectorMemoryBackend`: config-gated PostgreSQL/pgvector adapter for the
 * `@atlasai/atsh-memory` seam. NOT enabled by default — it requires the operator to
 * `pnpm add pg` and point at a Postgres with the pgvector extension (see the package README).
 * The `pg` module is loaded lazily via dynamic import inside methods — never at module top
 * level — so this package compiles and ships without `pg` installed; this backend is
 * exercised only in deployments that supply Postgres.
 *
 * Recall ranks by embedding cosine similarity when an `embed` function is configured, and
 * falls back to the same lexical token-overlap scoring as the SQLite backend otherwise.
 *
 * @module @atlasai/atsh-memory/pgvector
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { MemoryStore, RECALL_LIMIT_MAX } from './service.ts'
import { lexicalScore, tokenize } from './lexical.ts'
import type {
  MemoryGetOptions,
  MemoryListOptions,
  MemoryQueryOptions,
  MemoryRecallResult,
  MemoryRecord,
  MemoryReflectOptions,
  MemoryRetainInput,
  MemorySummary,
  PgVectorConfig,
} from './types.ts'

/** One pgvector `memories` row as read back by the adapter. */
interface PgMemoryRow {
  id: string
  namespace: string
  content: string
  metadata: string
  created_at: number
  embedding: string | null
}

/** Cosine similarity of two equal-length vectors, in [0, 1]; 0 when lengths mismatch or a vector is empty. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    // Lengths are validated equal above, so these never fall back; the `?? 0`
    // keeps the noUncheckedIndexedAccess types clean without non-null assertions.
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** Parse a stored JSON embedding array; malformed or absent embeddings score 0. */
function parseEmbedding(raw: string | null): number[] {
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(Number) : []
  } catch {
    return []
  }
}

/**
 * PostgreSQL + pgvector memory backend. The `memories` table is expected to exist with an
 * `embedding vector(n)` column (DDL in the package README); the configured `table` name is
 * interpolated into SQL, so it must be a trusted identifier. Connections are opened per
 * method call and always closed. Requires `pg` to be installed by the operator.
 */
export class PgVectorMemoryBackend extends MemoryStore {
  static Config: z<PgVectorConfig> = z.object({
    connectionString: z.string(),
    table: z.string(),
    embed: z.function(),
  })

  /** Postgres connection string used per call. */
  readonly connectionString: string
  /** Trusted identifier of the pgvector table. */
  readonly table: string
  /** Embedding function producing the query vector. */
  readonly embed: PgVectorConfig['embed']

  constructor(ctx: Context, config: PgVectorConfig) {
    super(ctx)
    this.connectionString = config.connectionString
    this.table = config.table ?? 'memories'
    this.embed = config.embed
  }

  async retain(record: MemoryRetainInput): Promise<MemoryRecord> {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: this.connectionString })
    await client.connect()
    try {
      const id = randomUUID()
      const namespace = record.namespace ?? ''
      const metadata = record.metadata ?? {}
      const createdAt = Date.now()
      const embedding = this.embed ? await this.embed(record.content) : null
      await client.query(
        `INSERT INTO ${this.table} (id, namespace, content, metadata, created_at, embedding) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, namespace, record.content, JSON.stringify(metadata), createdAt, embedding === null ? null : JSON.stringify(embedding)],
      )
      return { id, namespace, content: record.content, metadata, createdAt }
    } finally {
      await client.end()
    }
  }

  async recall(query: string, opts: MemoryQueryOptions = {}): Promise<MemoryRecallResult[]> {
    const limit = Math.min(opts.limit ?? 10, RECALL_LIMIT_MAX)
    const scoped = opts.namespace !== undefined
    const rows = await this.fetchRows(scoped ? ' WHERE namespace = $1' : '', scoped ? [opts.namespace] : [])
    const queryEmbedding = this.embed ? await this.embed(query) : undefined
    const scored = rows.map(row => ({
      row,
      score: queryEmbedding !== undefined
        ? cosineSimilarity(queryEmbedding, parseEmbedding(row.embedding))
        : lexicalScore(tokenize(query), tokenize(row.content)),
    }))
    scored.sort((a, b) => b.score - a.score || b.row.created_at - a.row.created_at)
    return scored.slice(0, limit).map(({ row, score }) => ({
      id: row.id,
      content: row.content,
      namespace: row.namespace,
      score,
    }))
  }

  async reflect(opts: MemoryReflectOptions = {}): Promise<MemorySummary> {
    const limit = opts.limit ?? 10
    const scoped = opts.namespace !== undefined
    const rows = await this.fetchRows(scoped ? ' WHERE namespace = $1' : '', scoped ? [opts.namespace] : [])
    const byNamespace: Record<string, number> = {}
    for (const row of rows) {
      byNamespace[row.namespace] = (byNamespace[row.namespace] ?? 0) + 1
    }
    return {
      total: rows.length,
      byNamespace,
      recent: rows.slice(0, limit).map(row => ({
        id: row.id,
        namespace: row.namespace,
        content: row.content,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        createdAt: row.created_at,
      })),
    }
  }

  async get(key: string, opts: MemoryGetOptions = {}): Promise<MemoryRecord | undefined> {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: this.connectionString })
    await client.connect()
    try {
      const result = await client.query(
        `SELECT id, namespace, content, metadata, created_at FROM ${this.table} WHERE namespace = $1 AND content = $2 ORDER BY created_at DESC LIMIT 1`,
        [opts.namespace ?? '', key],
      )
      const row = result.rows[0] as PgMemoryRow | undefined
      if (!row) return undefined
      return {
        id: row.id,
        namespace: row.namespace,
        content: row.content,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        createdAt: row.created_at,
      }
    } finally {
      await client.end()
    }
  }

  async list(opts: MemoryListOptions = {}): Promise<MemoryRecord[]> {
    const scoped = opts.namespace !== undefined
    const rows = await this.fetchRows(scoped ? ' WHERE namespace = $1' : '', scoped ? [opts.namespace] : [])
    return rows.map(row => ({
      id: row.id,
      namespace: row.namespace,
      content: row.content,
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      createdAt: row.created_at,
    }))
  }

  /**
   * Fetch the rows for one query, newest first, optionally scoped to one namespace. Opens a
   * fresh connection per call and always closes it.
   * @param where - validated `WHERE` clause fragment (built by callers from a namespace or empty).
   * @param params - positional parameters for the clause.
   * @returns physical rows, newest first.
   */
  private async fetchRows(where: string, params: unknown[]): Promise<PgMemoryRow[]> {
    const { Client } = await import('pg')
    const client = new Client({ connectionString: this.connectionString })
    await client.connect()
    try {
      const result = await client.query(
        `SELECT id, namespace, content, metadata, created_at, embedding FROM ${this.table}${where} ORDER BY created_at DESC`,
        params,
      )
      return result.rows as unknown as PgMemoryRow[]
    } finally {
      await client.end()
    }
  }
}

export default PgVectorMemoryBackend

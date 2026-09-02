/**
 * `SqliteMemoryBackend`: the default in-process implementation of the `@atlasai/atsh-memory`
 * seam, backed by Node's built-in `node:sqlite` (no npm dependency). Retains records verbatim
 * in a `memories` table, ranks recall by lexical token overlap, and reflects over totals,
 * per-namespace counts, and recent records.
 *
 * @module @atlasai/atsh-memory/sqlite
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
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
  SqliteConfig,
} from './types.ts'

/** One physical `memories` row as read back by the backend. */
interface MemoryRow {
  id: string
  namespace: string
  content: string
  metadata: string
  created_at: number
}

/**
 * Open (creating if needed) the SQLite database and ensure the `memories` table exists.
 * `:memory:` skips all filesystem setup; a file path creates missing parent directories.
 * @param path - database file path or `:memory:`.
 * @returns the open handle with the schema ensured.
 */
function openDatabase(path: string): DatabaseSync {
  const actual = path === ':memory:' ? ':memory:' : resolve(path)
  if (actual !== ':memory:') {
    mkdirSync(dirname(actual), { recursive: true, mode: 0o700 })
  }
  const db = new DatabaseSync(actual)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id         TEXT PRIMARY KEY,
      namespace  TEXT NOT NULL,
      content    TEXT NOT NULL,
      metadata   TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  return db
}

/** Rehydrate one physical row into a model-facing record. */
function toRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    namespace: row.namespace,
    content: row.content,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
  }
}

/**
 * SQLite-backed memory backend (the default). The database is closed when the owning fiber
 * unloads. Recall ranks by lexical token overlap (matched query tokens / total query tokens),
 * best first, honoring namespace scope and limit; ties break by recency.
 */
export class SqliteMemoryBackend extends MemoryStore {
  static Config: z<SqliteConfig> = z.object({
    path: z.string(),
  })

  /** Open database handle (public for tests/inspection). */
  readonly db: DatabaseSync

  constructor(ctx: Context, config: SqliteConfig) {
    super(ctx)
    this.db = openDatabase(config.path ?? ':memory:')
    this.ctx.effect(() => () => {
      this.db.close()
    }, 'dsh-memory: close sqlite database')
  }

  // oxlint-disable-next-line typescript/require-await -- synchronous node:sqlite backend; keeps the async Service Definition seam
  async retain(record: MemoryRetainInput): Promise<MemoryRecord> {
    const id = randomUUID()
    const namespace = record.namespace ?? ''
    const metadata = record.metadata ?? {}
    const createdAt = Date.now()
    this.db.prepare(
      'INSERT INTO memories (id, namespace, content, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, namespace, record.content, JSON.stringify(metadata), createdAt)
    return { id, namespace, content: record.content, metadata, createdAt }
  }

  // oxlint-disable-next-line typescript/require-await -- synchronous node:sqlite backend; keeps the async Service Definition seam
  async recall(query: string, opts: MemoryQueryOptions = {}): Promise<MemoryRecallResult[]> {
    const limit = Math.min(opts.limit ?? 10, RECALL_LIMIT_MAX)
    const scored = this.selectRows(opts.namespace).map(row => ({
      row,
      score: lexicalScore(tokenize(query), tokenize(row.content)),
    }))
    scored.sort((a, b) => b.score - a.score || b.row.created_at - a.row.created_at)
    return scored.slice(0, limit).map(({ row, score }) => ({
      id: row.id,
      content: row.content,
      namespace: row.namespace,
      score,
    }))
  }

  // oxlint-disable-next-line typescript/require-await -- synchronous node:sqlite backend; keeps the async Service Definition seam
  async reflect(opts: MemoryReflectOptions = {}): Promise<MemorySummary> {
    const limit = opts.limit ?? 10
    const rows = this.selectRows(opts.namespace)
    const byNamespace: Record<string, number> = {}
    for (const row of rows) {
      byNamespace[row.namespace] = (byNamespace[row.namespace] ?? 0) + 1
    }
    return {
      total: rows.length,
      byNamespace,
      recent: rows.slice(0, limit).map(toRecord),
    }
  }

  // oxlint-disable-next-line typescript/require-await -- synchronous node:sqlite backend; keeps the async Service Definition seam
  async get(key: string, opts: MemoryGetOptions = {}): Promise<MemoryRecord | undefined> {
    const row = this.db.prepare(
      'SELECT id, namespace, content, metadata, created_at FROM memories WHERE namespace = ? AND content = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    ).get(opts.namespace ?? '', key) as MemoryRow | undefined
    return row ? toRecord(row) : undefined
  }

  // oxlint-disable-next-line typescript/require-await -- synchronous node:sqlite backend; keeps the async Service Definition seam
  async list(opts: MemoryListOptions = {}): Promise<MemoryRecord[]> {
    return this.selectRows(opts.namespace).map(toRecord)
  }

  /**
   * Read the `memories` rows, newest first, optionally scoped to one namespace. Ties on
   * `created_at` break by insertion order (`rowid`), so "recent" is deterministic even for
   * retains that land in the same millisecond.
   * @param namespace - scope filter, or `undefined` for the whole store.
   * @returns physical rows, newest first.
   */
  private selectRows(namespace: string | undefined): MemoryRow[] {
    const scoped = namespace !== undefined
    const statement = scoped
      ? this.db.prepare(
        'SELECT id, namespace, content, metadata, created_at FROM memories WHERE namespace = ? ORDER BY created_at DESC, rowid DESC',
      )
      : this.db.prepare(
        'SELECT id, namespace, content, metadata, created_at FROM memories ORDER BY created_at DESC, rowid DESC',
      )
    const rows = scoped ? statement.all(namespace) : statement.all()
    return rows as unknown as MemoryRow[]
  }
}

export default SqliteMemoryBackend

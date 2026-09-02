/**
 * C2 orchestration (`ctx.coordination`): a controller-of-controllers service
 * that spawns subagent "workers" through the EXISTING subagent registry
 * (`ctx.subagents` — consumed, never modified) and coordinates them through a
 * SQLite-backed shared-state channel. Worker lifecycle rows and shared-state
 * entries land in one database, closed when the owning fiber unloads.
 *
 * The service is passive by default: with `enabled: false` it still registers
 * as `ctx.coordination`, but `spawnWorker` and `postState` reject with
 * `coordination disabled` while reads (`getState`, `listChannel`, ...) keep
 * working.
 *
 * @module @atlasai/atsh-coordination/service
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SubagentStartRequest } from '@atlasai/atsh-subagent'
import type {
  CoordinationConfig,
  CoordinationStats,
  SharedStateEntry,
  WorkerRecord,
  WorkerStatus,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    coordination: CoordinationService
  }
}

const SUPPORTED_CONFIG_KEYS = new Set(['enabled', 'sqlite'])

/** Reject stale or misspelled config keys before defaults can hide them. */
function validateConfigKeys(config: CoordinationConfig): void {
  for (const key of Object.keys(config)) {
    if (!SUPPORTED_CONFIG_KEYS.has(key)) {
      throw new Error(`CoordinationConfig: unknown key "${key}"`)
    }
  }
}

/** Shared-state schema version; bump on incompatible `coord_*` table changes. */
export const SCHEMA_VERSION = 1

/** One physical `coord_workers` row as read back by the service. */
interface WorkerRow {
  id: string
  provider: string
  status: string
  started_at: number
  finished_at: number | null
  outcome: string | null
}

/** One physical `coord_shared_state` row as read back by the service. */
interface SharedStateRow {
  channel: string
  key: string
  value: string
  revision: number
  updated_at: number
}

/**
 * Open (creating if needed) the coordination database and ensure the
 * `coord_workers` and `coord_shared_state` tables exist. `:memory:` skips all
 * filesystem setup; a file path creates missing parent directories.
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
    CREATE TABLE IF NOT EXISTS coord_workers (
      id          TEXT PRIMARY KEY,
      provider    TEXT NOT NULL,
      status      TEXT NOT NULL,
      started_at  INTEGER NOT NULL,
      finished_at INTEGER,
      outcome     TEXT
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS coord_shared_state (
      channel    TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      revision   INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (channel, key)
    )
  `)
  return db
}

/** Rehydrate one physical worker row into a model-facing record. */
function toWorkerRecord(row: WorkerRow): WorkerRecord {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status as WorkerStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    outcome: row.outcome,
  }
}

/** Rehydrate one physical shared-state row into a model-facing entry. */
function toSharedStateEntry(row: SharedStateRow): SharedStateEntry {
  return {
    channel: row.channel,
    key: row.key,
    value: JSON.parse(row.value) as unknown,
    revision: row.revision,
    updatedAt: row.updated_at,
  }
}

/**
 * C2 orchestration service. Load as a plugin (`ctx.plugin(CoordinationService,
 * config)`); it registers as `ctx.coordination` (one per context — loading a
 * second throws, cordis' standard duplicate-service behavior) and requires the
 * subagent registry (`ctx.subagents`), which it consumes but never modifies.
 * The SQLite backend closes when the owning fiber unloads.
 */
export class CoordinationService extends Service {
  static Config = z.object({
    enabled: z.boolean(),
    sqlite: z.object({ path: z.string() }),
  })

  /** The subagent registry is REQUIRED: C2 consumes it, never modifies it. */
  static inject = ['subagents']

  /** Open coordination database handle (public for tests/inspection). */
  readonly db: DatabaseSync

  private readonly enabled: boolean

  constructor(ctx: Context, config: CoordinationConfig) {
    super(ctx, 'coordination')
    validateConfigKeys(config)
    this.enabled = config.enabled ?? true
    this.db = openDatabase(config.sqlite?.path ?? ':memory:')
    this.ctx.effect(() => () => { this.db.close() }, 'dsh-coordination: close coordination database')
  }

  /**
   * Spawn one subagent worker on the named provider and record its lifecycle
   * in the `coord_workers` table. The row is inserted as `'running'` before
   * the run settles; this resolves only after the run does, with the row
   * flipped to `'completed'` (outcome = joined text output, or
   * `JSON.stringify(structured)` when the run returned one) or `'failed'`
   * (outcome = the error text). Emits `coordination/worker-started` after the
   * row lands and `coordination/worker-completed` after the update lands.
   * @param provider - a registered subagent provider name.
   * @param request - the subagent delegation request (label, prompt, parent, signal).
   * @returns the worker record id.
   * @throws when the provider is not registered or coordination is disabled.
   */
  async spawnWorker(provider: string, request: SubagentStartRequest): Promise<string> {
    if (!this.enabled) throw new Error('coordination disabled')
    if (this.ctx.subagents.getProvider(provider) === undefined) {
      throw new Error(`coordination: subagent provider "${provider}" not registered`)
    }
    const run = await this.ctx.subagents.start(provider, request)
    const workerId = randomUUID()
    this.db.prepare(
      'INSERT INTO coord_workers (id, provider, status, started_at) VALUES (?, ?, ?, ?)',
    ).run(workerId, provider, 'running', Date.now())
    this.ctx.emit('coordination/worker-started', { workerId, provider })
    let status: WorkerStatus = 'completed'
    let outcome: string
    try {
      const result = await run.result
      if (result.structured !== undefined) {
        outcome = JSON.stringify(result.structured)
      } else {
        outcome = result.output.filter(block => block.type === 'text')
          .map(block => block.text).join('\n')
      }
    } catch (error) {
      status = 'failed'
      outcome = String(error)
    }
    this.db.prepare(
      'UPDATE coord_workers SET status = ?, finished_at = ?, outcome = ? WHERE id = ?',
    ).run(status, Date.now(), outcome, workerId)
    this.ctx.emit('coordination/worker-completed', { workerId, provider, status })
    return workerId
  }

  /**
   * Read one worker record by id.
   * @param id - the worker record id returned by {@link spawnWorker}.
   * @returns the hydrated record, or `undefined` when no such row exists.
   */
  getWorker(id: string): WorkerRecord | undefined {
    const row = this.db.prepare(
      'SELECT id, provider, status, started_at, finished_at, outcome FROM coord_workers WHERE id = ?',
    ).get(id) as WorkerRow | undefined
    return row === undefined ? undefined : toWorkerRecord(row)
  }

  /**
   * List worker records, optionally filtered by status, newest first.
   * @param status - optional status filter.
   * @returns hydrated worker records.
   */
  listWorkers(status?: WorkerStatus): WorkerRecord[] {
    const rows = status === undefined
      ? this.db.prepare(
        'SELECT id, provider, status, started_at, finished_at, outcome FROM coord_workers ORDER BY started_at DESC, rowid DESC',
      ).all()
      : this.db.prepare(
        'SELECT id, provider, status, started_at, finished_at, outcome FROM coord_workers WHERE status = ? ORDER BY started_at DESC, rowid DESC',
      ).all(status)
    return (rows as unknown as WorkerRow[]).map(toWorkerRecord)
  }

  /**
   * Snapshot of the coordination tables' counters.
   * @returns the worker/channel row counts.
   */
  getStats(): CoordinationStats {
    const count = (sql: string, ...params: SQLInputValue[]): number => {
      const row = this.db.prepare(sql).get(...params) as { n: number } | undefined
      return row?.n ?? 0
    }
    return {
      workers: {
        total: count('SELECT COUNT(*) AS n FROM coord_workers'),
        running: count('SELECT COUNT(*) AS n FROM coord_workers WHERE status = ?', 'running'),
        completed: count('SELECT COUNT(*) AS n FROM coord_workers WHERE status = ?', 'completed'),
        failed: count('SELECT COUNT(*) AS n FROM coord_workers WHERE status = ?', 'failed'),
      },
      channels: count('SELECT COUNT(DISTINCT channel) AS n FROM coord_shared_state'),
    }
  }

  /**
   * Write one shared-state entry, bumping the per-(channel, key) revision
   * monotonically (starting at 1) and upserting the row.
   * @param channel - channel name.
   * @param key - entry key within the channel.
   * @param value - JSON-serializable value; `undefined` and functions reject.
   * @returns the new revision.
   * @throws {TypeError} when the value cannot be JSON-serialized.
   * @throws when coordination is disabled.
   */
  postState(channel: string, key: string, value: unknown): { revision: number } {
    if (!this.enabled) throw new Error('coordination disabled')
    if (value === undefined || typeof value === 'function') {
      throw new TypeError('coordination: shared state value must be JSON-serializable')
    }
    const serialized = JSON.stringify(value)
    const row = this.db.prepare(
      'SELECT COALESCE(MAX(revision), 0) AS n FROM coord_shared_state WHERE channel = ? AND key = ?',
    ).get(channel, key) as { n: number } | undefined
    const revision = (row?.n ?? 0) + 1
    this.db.prepare(`
      INSERT INTO coord_shared_state (channel, key, value, revision, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(channel, key) DO UPDATE
        SET value = excluded.value, revision = excluded.revision, updated_at = excluded.updated_at
    `).run(channel, key, serialized, revision, Date.now())
    return { revision }
  }

  /**
   * Read one shared-state entry.
   * @param channel - channel name.
   * @param key - entry key within the channel.
   * @returns the hydrated entry, or `undefined` when absent.
   */
  getState(channel: string, key: string): SharedStateEntry | undefined {
    const row = this.db.prepare(
      'SELECT channel, key, value, revision, updated_at FROM coord_shared_state WHERE channel = ? AND key = ?',
    ).get(channel, key) as SharedStateRow | undefined
    return row === undefined ? undefined : toSharedStateEntry(row)
  }

  /**
   * List one channel's entries ordered by revision.
   * @param channel - channel name.
   * @returns hydrated entries in write order.
   */
  listChannel(channel: string): SharedStateEntry[] {
    const rows = this.db.prepare(
      'SELECT channel, key, value, revision, updated_at FROM coord_shared_state WHERE channel = ? ORDER BY revision',
    ).all(channel)
    return (rows as unknown as SharedStateRow[]).map(toSharedStateEntry)
  }
}

export default CoordinationService

/**
 * Default SQLite backend for `ctx.kgraph`: flat objective / key-result / evidence
 * tables over `node:sqlite`, plus the deterministic session-log autobuilder.
 *
 * @module @atlasai/atsh-kgraph/sqlite
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { KGraph } from './service.ts'
import type {
  AddEvidenceInput,
  AddKeyResultInput,
  Evidence,
  GraphBuildResult,
  KGraphStats,
  KeyResult,
  Objective,
  SessionLogEventLike,
  SessionLogReader,
  UpsertObjectiveInput,
} from './types.ts'

/** Monotonic schema version of the kgraph store. */
const SCHEMA_VERSION = 1

/**
 * Open (creating if needed) the SQLite database and ensure the kgraph tables exist.
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
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kgraph_objectives (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kgraph_key_results (
      id           TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL,
      name         TEXT NOT NULL,
      metric       TEXT,
      target       TEXT,
      current      TEXT,
      status       TEXT NOT NULL DEFAULT 'on-track',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kgraph_evidence (
      id           TEXT PRIMARY KEY,
      objective_id TEXT NOT NULL,
      kr_id        TEXT,
      session_id   TEXT NOT NULL,
      seq          INTEGER NOT NULL,
      event_type   TEXT NOT NULL,
      excerpt      TEXT NOT NULL,
      time         INTEGER NOT NULL,
      created_at   INTEGER NOT NULL,
      UNIQUE(session_id, seq)
    );
  `)
  return db
}

/** SQLite-backed {@link KGraph} store. */
export class SqliteKGraphStore extends KGraph {
  /** Open database handle (public for tests and inspection). */
  readonly db: DatabaseSync
  /** Optional session-log reader override (test seam); production falls back to `ctx.sessionQuery`. */
  private readonly reader: SessionLogReader | undefined

  /**
   * @param ctx - registrant context; registers as `ctx.kgraph` via the service constructor.
   * @param config - store settings plus the optional reader seam.
   */
  constructor(ctx: Context, config: KGraphStoreConfig = {}) {
    super(ctx)
    this.reader = config.reader
    this.db = openDatabase(config.path ?? ':memory:')
    this.ctx.effect(() => () => {
      this.db.close()
    }, 'dsh-kgraph: close sqlite database')
  }

  /** Create or update one objective. */
  // oxlint-disable-next-line typescript/require-await -- synchronous node:sqlite backend; keeps the async Service Definition seam
  async upsertObjective(input: UpsertObjectiveInput): Promise<Objective> {
    const now = Date.now()
    let id = input.id
    if (id) {
      this.db.prepare(
        'UPDATE kgraph_objectives SET name = ?, description = ?, updated_at = ? WHERE id = ?',
      ).run(input.name, input.description ?? null, now, id)
    } else {
      id = randomUUID()
      this.db.prepare(
        "INSERT INTO kgraph_objectives (id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
      ).run(id, input.name, input.description ?? null, now, now)
    }
    return this.loadObjective(id)
  }

  /** List all objectives with key results attached, oldest first. */
  // oxlint-disable-next-line typescript/require-await -- synchronous node:sqlite backend; keeps the async Service Definition seam
  async listObjectives(): Promise<Objective[]> {
    const rows = this.db.prepare(
      'SELECT * FROM kgraph_objectives ORDER BY created_at ASC',
    ).all() as unknown as ObjectiveRow[]
    const krs = this.db.prepare(
      'SELECT * FROM kgraph_key_results ORDER BY created_at ASC',
    ).all() as unknown as KeyResultRow[]
    return rows.map(row => this.rowToObjective(row, krs.filter(k => k.objective_id === row.id)))
  }

  /** Append one key result to an objective. */
  // oxlint-disable-next-line typescript/require-await -- synchronous node:sqlite backend; keeps the async Service Definition seam
  async addKeyResult(input: AddKeyResultInput): Promise<KeyResult> {
    const id = randomUUID()
    const now = Date.now()
    this.db.prepare(
      "INSERT INTO kgraph_key_results (id, objective_id, name, metric, target, current, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'on-track', ?, ?)",
    ).run(id, input.objectiveId, input.name, input.metric ?? null, input.target ?? null, null, now, now)
    const row = this.db.prepare(
      'SELECT * FROM kgraph_key_results WHERE id = ?',
    ).get(id) as unknown as KeyResultRow
    return this.rowToKeyResult(row)
  }

  /** Persist one evidence row; `(session_id, seq)` uniqueness makes replays idempotent. */
  // oxlint-disable-next-line typescript/require-await -- synchronous node:sqlite backend; keeps the async Service Definition seam
  async addEvidence(input: AddEvidenceInput): Promise<Evidence> {
    this.db.prepare(
      'INSERT OR IGNORE INTO kgraph_evidence (id, objective_id, kr_id, session_id, seq, event_type, excerpt, time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      randomUUID(),
      input.objectiveId,
      input.krId ?? null,
      input.sessionId,
      input.seq,
      input.eventType,
      input.excerpt,
      input.time,
      Date.now(),
    )
    const row = this.db.prepare(
      'SELECT * FROM kgraph_evidence WHERE session_id = ? AND seq = ?',
    ).get(input.sessionId, input.seq) as unknown as EvidenceRow
    return this.rowToEvidence(row)
  }

  /**
   * Derive objectives and evidence from one session log. Deterministic: a
   * `user/message` event whose payload has a string `content` seeds one objective
   * named from the first 80 characters; `assistant/message` and `tool/result`
   * events become evidence rows. Replays add nothing (idempotent per
   * `(session_id, seq)`). No LLM judgment anywhere.
   */
  async buildGraphFromSession(sessionId: string): Promise<GraphBuildResult> {
    let snapshot
    if (this.reader) {
      snapshot = await this.reader(sessionId)
    } else {
      const sq = this.ctx.get('sessionQuery') as
        | { readSession?: (id: string) => Promise<{ header?: unknown; events?: SessionLogEventLike[] }> }
        | undefined
      snapshot = sq?.readSession ? await sq.readSession(sessionId) : undefined
    }
    if (!snapshot?.events?.length) {
      return { sessionId, objectivesCreated: 0, evidenceAdded: 0 }
    }
    let objectivesCreated = 0
    let evidenceAdded = 0
    for (const event of snapshot.events) {
      const existing = this.db.prepare(
        'SELECT COUNT(*) AS n FROM kgraph_evidence WHERE session_id = ? AND seq = ?',
      ).get(sessionId, event.seq) as { n: number }
      if (existing.n > 0) continue
      const data = event.data as Record<string, unknown> | undefined
      if (event.type === 'user/message' && typeof data?.content === 'string') {
        const name = data.content.slice(0, 80)
        const objectives = await this.listObjectives()
        if (!objectives.some(o => o.name === name)) {
          await this.upsertObjective({ name })
          objectivesCreated += 1
        }
      } else if (event.type === 'assistant/message' || event.type === 'tool/result') {
        const excerpt = JSON.stringify(data ?? {}).slice(0, 200)
        const objectives = await this.listObjectives()
        const first = objectives[0]
        if (!first) continue
        await this.addEvidence({
          objectiveId: first.id,
          sessionId,
          seq: event.seq,
          eventType: event.type,
          excerpt,
          time: event.time,
        })
        evidenceAdded += 1
      }
    }
    return { sessionId, objectivesCreated, evidenceAdded }
  }

  /** Report aggregate counts. */
  // oxlint-disable-next-line typescript/require-await -- synchronous node:sqlite backend; keeps the async Service Definition seam
  async getStats(): Promise<KGraphStats> {
    const count = (table: string): number =>
      (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    const sessions = this.db.prepare(
      'SELECT COUNT(DISTINCT session_id) AS n FROM kgraph_evidence',
    ).get() as { n: number }
    return {
      objectives: count('kgraph_objectives'),
      keyResults: count('kgraph_key_results'),
      evidence: count('kgraph_evidence'),
      sessionsIngested: sessions.n,
    }
  }

  private loadObjective(id: string): Objective {
    const row = this.db.prepare(
      'SELECT * FROM kgraph_objectives WHERE id = ?',
    ).get(id) as unknown as ObjectiveRow
    const krs = this.db.prepare(
      'SELECT * FROM kgraph_key_results WHERE objective_id = ? ORDER BY created_at ASC',
    ).all(id) as unknown as KeyResultRow[]
    return this.rowToObjective(row, krs)
  }

  private rowToObjective(row: ObjectiveRow, krs: KeyResultRow[] = []): Objective {
    return {
      id: row.id,
      name: row.name,
      ...(row.description !== null ? { description: row.description } : {}),
      status: row.status as Objective['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      keyResults: krs.map(k => this.rowToKeyResult(k)),
    }
  }

  private rowToKeyResult(row: KeyResultRow): KeyResult {
    return {
      id: row.id,
      objectiveId: row.objective_id,
      name: row.name,
      ...(row.metric !== null ? { metric: row.metric } : {}),
      ...(row.target !== null ? { target: row.target } : {}),
      ...(row.current !== null ? { current: row.current } : {}),
      status: row.status as KeyResult['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private rowToEvidence(row: EvidenceRow): Evidence {
    return {
      id: row.id,
      objectiveId: row.objective_id,
      ...(row.kr_id !== null ? { krId: row.kr_id } : {}),
      sessionId: row.session_id,
      seq: row.seq,
      eventType: row.event_type,
      excerpt: row.excerpt,
      time: row.time,
      createdAt: row.created_at,
    }
  }
}

/** Store configuration: sqlite path plus the optional session-log reader seam. */
export interface KGraphStoreConfig {
  /** Database file path; `':memory:'` is the default. */
  path?: string
  /** Override the session-log reader (internal test seam; production uses `ctx.sessionQuery`). */
  reader?: SessionLogReader
}

interface ObjectiveRow {
  id: string
  name: string
  description: string | null
  status: string
  created_at: number
  updated_at: number
}

interface KeyResultRow {
  id: string
  objective_id: string
  name: string
  metric: string | null
  target: string | null
  current: string | null
  status: string
  created_at: number
  updated_at: number
}

interface EvidenceRow {
  id: string
  objective_id: string
  kr_id: string | null
  session_id: string
  seq: number
  event_type: string
  excerpt: string
  time: number
  created_at: number
}

/**
 * Service Definition for the capability-gated LLM router (`ctx.llmRouter`): intercepts the
 * `llm/stream` Cordis waterfall, rewrites `provider` / `model` for non-frozen requests that
 * mismatch their capability's configured route, and logs every completed call to a SQLite
 * call log, emitting `router/call-logged` for downstream consumers (e.g. the
 * `@atlasai/atsh-router-trainer` plugin).
 *
 * Routing is capability-gated: the router classifies each call as `options.purpose ??
 * 'general'` and looks up that capability's route in `config.routes`. Loop-built requests
 * arrive deep-frozen and are never mutated — a frozen mismatch degrades to an advisory
 * decision: the call still goes out exactly as requested, and the log records the gap.
 * A listener that never calls `next()` vetoes the rest of the chain, so this service
 * ALWAYS calls `next()` and wraps the resulting stream rather than short-circuiting.
 *
 * @module @atlasai/atsh-router/service
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { GenerateOptions, StreamChunk } from '@atlasai/atsh-llm'
import type {
  CallStatus,
  RouterCallRecord,
  RouterConfig,
  RouterRoute,
  RouteState,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llmRouter: LlmRouter
  }
}

const SUPPORTED_CONFIG_KEYS = new Set(['enabled', 'applyRoutes', 'routes', 'sqlite'])

/** Reject stale or misspelled config keys before defaults can hide them. */
function validateConfigKeys(config: RouterConfig): void {
  for (const key of Object.keys(config)) {
    if (!SUPPORTED_CONFIG_KEYS.has(key)) {
      throw new Error(`RouterConfig: unknown key "${key}"`)
    }
  }
}

/** One physical `call_log` row as read back by the log. */
interface CallLogRow {
  id: string
  ts: number
  session_id: string | null
  capability: string
  requested_provider: string
  requested_model: string
  resolved_provider: string
  resolved_model: string
  route_state: RouteState
  status: CallStatus
  chunk_count: number
  error_code: string | null
  duration_ms: number
  meta: string
}

/**
 * Open (creating if needed) the call-log database and ensure the `call_log` table exists.
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
    CREATE TABLE IF NOT EXISTS call_log (
      id                 TEXT PRIMARY KEY,
      ts                 INTEGER NOT NULL,
      session_id         TEXT,
      capability         TEXT NOT NULL,
      requested_provider TEXT NOT NULL,
      requested_model    TEXT NOT NULL,
      resolved_provider  TEXT NOT NULL,
      resolved_model     TEXT NOT NULL,
      route_state        TEXT NOT NULL,
      status             TEXT NOT NULL,
      chunk_count        INTEGER NOT NULL DEFAULT 0,
      error_code         TEXT,
      duration_ms        INTEGER NOT NULL,
      meta               TEXT NOT NULL
    )
  `)
  return db
}

/** Rehydrate one physical row into a model-facing record. */
function toRecord(row: CallLogRow): RouterCallRecord {
  return {
    id: row.id,
    ts: row.ts,
    capability: row.capability,
    requestedProvider: row.requested_provider,
    requestedModel: row.requested_model,
    resolvedProvider: row.resolved_provider,
    resolvedModel: row.resolved_model,
    routeState: row.route_state,
    status: row.status,
    chunkCount: row.chunk_count,
    errorCode: row.error_code,
    durationMs: row.duration_ms,
    meta: JSON.parse(row.meta) as Record<string, unknown>,
    ...(row.session_id !== null ? { sessionId: row.session_id } : {}),
  }
}

/** Classify + route one call; captured before the wrapped stream is consumed. */
interface RoutingDecision {
  capability: string
  routeState: RouteState
  requestedProvider: string
  requestedModel: string
  resolvedProvider: string
  resolvedModel: string
}

/**
 * Capability-gated LLM router. Load as a plugin (`ctx.plugin(LlmRouter, config)`); it
 * registers as `ctx.llmRouter` (one router per context — loading a second throws, cordis'
 * standard duplicate-service behavior) and, when enabled, listens on the `llm/stream`
 * waterfall.
 */
export class LlmRouter extends Service {
  static Config: z<RouterConfig> = z.object({
    enabled: z.boolean(),
    applyRoutes: z.boolean(),
    routes: z.dict(z.object({ provider: z.string(), model: z.string() })),
    sqlite: z.object({ path: z.string() }),
  })

  /** Open call-log database handle (public for tests/inspection). */
  readonly db: DatabaseSync

  private readonly applyRoutes: boolean
  private readonly routes: Record<string, RouterRoute>

  constructor(ctx: Context, config: RouterConfig) {
    super(ctx, 'llmRouter')
    validateConfigKeys(config)
    this.applyRoutes = config.applyRoutes ?? true
    this.routes = config.routes ?? {}
    this.db = openDatabase(config.sqlite?.path ?? ':memory:')
    this.ctx.effect(() => () => {
      this.db.close()
    }, 'dsh-router: close call log database')
    if (config.enabled ?? true) {
      this.ctx.on('llm/stream', (options, next) => this.handleStream(options, next))
    }
  }

  /**
   * Return the configured route for a capability, if any.
   * @param capability - capability name (`'general'`, `'reasoning'`, ...).
   * @returns the configured route, or `undefined` when unconfigured.
   */
  routeFor(capability: string): RouterRoute | undefined {
    return this.routes[capability]
  }

  /**
   * Read the most recent logged calls, newest first.
   * @param limit - maximum records to return (default 50).
   * @returns hydrated call records.
   */
  listCalls(limit: number = 50): RouterCallRecord[] {
    const rows = this.db.prepare(
      'SELECT id, ts, session_id, capability, requested_provider, requested_model, resolved_provider, resolved_model, route_state, status, chunk_count, error_code, duration_ms, meta FROM call_log ORDER BY ts DESC, rowid DESC LIMIT ?',
    ).all(limit)
    return (rows as unknown as CallLogRow[]).map(toRecord)
  }

  /**
   * Total number of logged calls.
   * @returns the call-log row count.
   */
  countCalls(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM call_log').get() as
      | { n: number }
      | undefined
    return row?.n ?? 0
  }

  /**
   * Intercept one `llm/stream` call: classify its capability, decide the route
   * (rewriting a non-frozen mismatch when `applyRoutes` is on), wrap the chained stream
   * to count chunks and time the call, then insert the `call_log` row and emit
   * `router/call-logged` once the stream settles (success or error). The error is
   * re-thrown so consumers see the stream fail exactly as it would without routing.
   */
  private handleStream(
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncIterable<StreamChunk> {
    const startedAt = Date.now()
    const decision = this.decide(options)
    const finish = (status: CallStatus, errorCode: string | null, chunkCount: number) => {
      this.insertAndEmit(decision, options, status, errorCode, chunkCount, Date.now() - startedAt)
    }

    return (async function* wrapped(): AsyncGenerator<StreamChunk> {
      let chunkCount = 0
      let status: CallStatus = 'ok'
      let errorCode: string | null = null
      try {
        const source = next()
        for await (const chunk of source) {
          chunkCount += 1
          yield chunk
        }
      } catch (error) {
        status = 'error'
        errorCode = error instanceof Error ? error.name : String(error)
        throw error
      } finally {
        finish(status, errorCode, chunkCount)
      }
    })()
  }

  /** Classify the call's capability and resolve the route decision. */
  private decide(options: GenerateOptions): RoutingDecision {
    const capability = options.purpose ?? 'general'
    const route = this.routes[capability]
    const requestedProvider = options.provider
    const requestedModel = options.model
    let routeState: RouteState
    if (route === undefined) {
      routeState = 'none'
    } else if (route.provider !== requestedProvider || route.model !== requestedModel) {
      if (!Object.isFrozen(options) && this.applyRoutes) {
        options.provider = route.provider
        options.model = route.model
        routeState = 'rewritten'
      } else {
        routeState = 'advisory'
      }
    } else {
      routeState = 'matched'
    }
    return {
      capability,
      routeState,
      requestedProvider,
      requestedModel,
      resolvedProvider: options.provider,
      resolvedModel: options.model,
    }
  }

  /** Insert the call-log row, then emit `router/call-logged` with the same record. */
  private insertAndEmit(
    decision: RoutingDecision,
    options: GenerateOptions,
    status: CallStatus,
    errorCode: string | null,
    chunkCount: number,
    durationMs: number,
  ): void {
    const record: RouterCallRecord = {
      id: randomUUID(),
      ts: Date.now(),
      capability: decision.capability,
      requestedProvider: decision.requestedProvider,
      requestedModel: decision.requestedModel,
      resolvedProvider: decision.resolvedProvider,
      resolvedModel: decision.resolvedModel,
      routeState: decision.routeState,
      status,
      chunkCount,
      errorCode,
      durationMs,
      meta: { messageCount: options.messages.length },
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    }
    this.db.prepare(
      'INSERT INTO call_log (id, ts, session_id, capability, requested_provider, requested_model, resolved_provider, resolved_model, route_state, status, chunk_count, error_code, duration_ms, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      record.id,
      record.ts,
      record.sessionId ?? null,
      record.capability,
      record.requestedProvider,
      record.requestedModel,
      record.resolvedProvider,
      record.resolvedModel,
      record.routeState,
      record.status,
      record.chunkCount,
      record.errorCode,
      record.durationMs,
      JSON.stringify(record.meta),
    )
    this.ctx.emit('router/call-logged', record)
  }
}

export default LlmRouter

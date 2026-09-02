/**
 * Canonical types for `@atlasai/atsh-router`: routing configuration, the per-call
 * decision vocabulary, and the `router/call-logged` event payload shared with consumers
 * such as `@atlasai/atsh-router-trainer`. Types only — no runtime code.
 * @module @atlasai/atsh-router/types
 */

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A routed model call completed and was appended to the call log. Fires once per
     * call, after the row lands, carrying the same record that was inserted.
     * @param record - the persisted call-log row.
     * @mode emit
     */
    'router/call-logged'(record: RouterCallRecord): void
  }
}

/** One configured route: which provider/model serves a capability. */
export interface RouterRoute {
  /** Provider route key passed through to `GenerateOptions.provider`. */
  provider: string
  /** Model id passed through to `GenerateOptions.model`. */
  model: string
}

/** Configuration for the {@link LlmRouter} service. */
export interface RouterConfig {
  /** Intercept the `llm/stream` waterfall. Defaults to `true`. */
  enabled?: boolean
  /**
   * Rewrite `options.provider` / `options.model` on non-frozen requests that mismatch
   * their capability's route. Defaults to `true`. Deep-frozen (loop-built) requests are
   * never rewritten — a frozen mismatch degrades to an advisory decision instead.
   */
  applyRoutes?: boolean
  /** Capability → route map; the router classifies each call as `options.purpose ?? 'general'`. */
  routes?: Record<string, RouterRoute>
  /** SQLite call-log backend options. */
  sqlite?: {
    /** Database file path, or `':memory:'` (the default) for an in-process log. */
    path?: string
  }
}

/** What the router decided for one call. */
export type RouteState = 'none' | 'matched' | 'rewritten' | 'advisory'

/** Terminal outcome of the streamed call. */
export type CallStatus = 'ok' | 'error'

/**
 * One logged model call: inserted into the SQLite `call_log` table and emitted as the
 * `router/call-logged` event payload.
 */
export interface RouterCallRecord {
  /** Unique record id (UUID). */
  id: string
  /** Completion timestamp (epoch ms). */
  ts: number
  /** Session identity stamped by the loop, when the request carried one. */
  sessionId?: string
  /** Capability the call was classified under (`options.purpose ?? 'general'`). */
  capability: string
  /** Provider the caller asked for. */
  requestedProvider: string
  /** Model the caller asked for. */
  requestedModel: string
  /** Provider the call actually went out with (post-rewrite). */
  resolvedProvider: string
  /** Model the call actually went out with (post-rewrite). */
  resolvedModel: string
  /** Routing decision: no route, matched, rewritten, or advisory. */
  routeState: RouteState
  /** Terminal stream outcome. */
  status: CallStatus
  /** Chunks yielded to the consumer. */
  chunkCount: number
  /** Error name when the stream failed, else `null`. */
  errorCode: string | null
  /** Wall-clock stream duration in ms. */
  durationMs: number
  /** Free-form record metadata (message count, ...). */
  meta: Record<string, unknown>
}

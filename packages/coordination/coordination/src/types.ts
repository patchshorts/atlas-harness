/**
 * Canonical types for `@atlasai/atsh-coordination`: coordination
 * configuration, the worker vocabulary, the `coordination/worker-started` /
 * `coordination/worker-completed` event payloads, shared-state entries, and
 * the stats snapshot. Types only — no runtime code.
 * @module @atlasai/atsh-coordination/types
 */

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A subagent worker was published by the subagent registry and recorded
     * as `'running'` in the `coord_workers` table. Fires once per spawn,
     * after the row lands.
     * @param payload.workerId - the spawned worker's id.
     * @param payload.provider - the provider key that spawned it.
     * @mode emit
     */
    'coordination/worker-started'(payload: { workerId: string; provider: string }): void
    /**
     * A subagent worker settled and its `coord_workers` row was updated to
     * `'completed'` or `'failed'` with the outcome text. Fires once per
     * spawn, after the row lands.
     * @param payload.workerId - the settled worker's id.
     * @param payload.provider - the provider key that spawned it.
     * @param payload.status - `'completed'` or `'failed'`.
     * @mode emit
     */
    'coordination/worker-completed'(payload: {
      workerId: string
      provider: string
      status: WorkerStatus
    }): void
  }
}

/** Configuration for the {@link CoordinationService} service. */
export interface CoordinationConfig {
  /**
   * Whether worker spawns and shared-state writes are allowed. Defaults to
   * `true`; with `false` the service still registers as `ctx.coordination`
   * but `spawnWorker` / `postState` reject with `coordination disabled`.
   */
  enabled?: boolean
  /** SQLite backend options. */
  sqlite?: {
    /** Database file path, or `':memory:'` (the default) for an in-process store. */
    path?: string
  }
}

/** Lifecycle status of one recorded subagent worker. */
export type WorkerStatus = 'running' | 'completed' | 'failed'

/** One worker row, hydrated from the `coord_workers` table. */
export interface WorkerRecord {
  /** Worker row id (uuid). */
  id: string
  /** Subagent provider name the worker was spawned on. */
  provider: string
  /** Current lifecycle status. */
  status: WorkerStatus
  /** Row timestamp of the spawn (epoch ms). */
  startedAt: number
  /** Row timestamp of the settlement (epoch ms), or `null` while running. */
  finishedAt: number | null
  /** Joined text output (or `JSON.stringify(structured)`), or the error text on failure. */
  outcome: string | null
}

/** One shared-state entry, hydrated from the `coord_shared_state` table. */
export interface SharedStateEntry {
  /** Channel name the entry belongs to. */
  channel: string
  /** Entry key within the channel. */
  key: string
  /** The deserialized value (JSON round-trip). */
  value: unknown
  /** Monotonic per-(channel, key) write revision, starting at 1. */
  revision: number
  /** Last write timestamp (epoch ms). */
  updatedAt: number
}

/** Snapshot of the coordination tables' counters. */
export interface CoordinationStats {
  /** Worker-status counters across the `coord_workers` table. */
  workers: {
    /** Total worker rows. */
    total: number
    /** Rows still `'running'`. */
    running: number
    /** Rows settled `'completed'`. */
    completed: number
    /** Rows settled `'failed'`. */
    failed: number
  }
  /** Distinct channel names present in `coord_shared_state`. */
  channels: number
}

/**
 * OKR knowledge-graph types for the DeepSeek Harness: the Objective / Key
 * Result / Evidence model and the config surface of the `ctx.kgraph` seam.
 *
 * @module @atlasai/atsh-kgraph/types
 */

/** Structural view of one session-log event the autobuilder consumes. */
export interface SessionLogEventLike {
  /** Monotonic sequence number within the session. */
  seq: number
  /** Event timestamp in Unix epoch milliseconds. */
  time: number
  /** Discriminant of the session event ('user/message', 'assistant/message', 'tool/result', ...). */
  type: string
  /** Event payload; extraction reads `content` when present and stringifies otherwise. */
  data?: unknown
}

/** Structural view of one session log the autobuilder consumes. */
export interface SessionLogSnapshotLike {
  /** Session header; unused by extraction today. */
  header?: unknown
  /** Complete event list in sequence order. */
  events: SessionLogEventLike[]
}

/** Reads one session's log for the autobuilder. Tests inject a stub. */
export type SessionLogReader = (sessionId: string) => Promise<SessionLogSnapshotLike>

/** Configuration of the kgraph service plugin. */
export interface KGraphConfig {
  /** SQLite store settings. */
  sqlite?: {
    /** Database file path; `':memory:'` is the default. */
    path?: string
  }
  /** Override the session-log reader (internal test seam; production uses `ctx.sessionQuery`). */
  reader?: SessionLogReader
}

/** One Objective: the top node of the OKR graph. */
export interface Objective {
  /** Stable unique identifier. */
  id: string
  /** Short imperative statement of the objective. */
  name: string
  /** Optional elaboration. */
  description?: string
  /** Lifecycle status. */
  status: 'active' | 'achieved' | 'abandoned'
  /** Creation time in Unix epoch milliseconds. */
  createdAt: number
  /** Last modification time in Unix epoch milliseconds. */
  updatedAt: number
  /** Key results measured under this objective. */
  keyResults: KeyResult[]
}

/** One Key Result: a measurable outcome under an Objective. */
export interface KeyResult {
  /** Stable unique identifier. */
  id: string
  /** Owning objective's id. */
  objectiveId: string
  /** Outcome statement. */
  name: string
  /** Optional unit or measurement name. */
  metric?: string
  /** Optional target value. */
  target?: string
  /** Optional current value. */
  current?: string
  /** Progress status. */
  status: 'on-track' | 'at-risk' | 'achieved'
  /** Creation time in Unix epoch milliseconds. */
  createdAt: number
  /** Last modification time in Unix epoch milliseconds. */
  updatedAt: number
}

/** One Evidence row: a durable pointer to a session-log event backing progress. */
export interface Evidence {
  /** Stable unique identifier. */
  id: string
  /** Owning objective's id. */
  objectiveId: string
  /** Optional owning key result's id. */
  krId?: string
  /** Session the evidence was derived from. */
  sessionId: string
  /** Sequence number of the source event within the session. */
  seq: number
  /** Discriminant of the source event. */
  eventType: string
  /** Model-visible excerpt of the source event content. */
  excerpt: string
  /** Timestamp of the source event in Unix epoch milliseconds. */
  time: number
  /** Record creation time in Unix epoch milliseconds. */
  createdAt: number
}

/** Aggregate counts of the graph store. */
export interface KGraphStats {
  /** Objective row count. */
  objectives: number
  /** Key result row count. */
  keyResults: number
  /** Evidence row count. */
  evidence: number
  /** Number of distinct sessions that contributed evidence. */
  sessionsIngested: number
}

/** Input for creating or updating one objective. */
export interface UpsertObjectiveInput {
  /** Existing id to update; omitted creates a new row. */
  id?: string
  /** Objective name. */
  name: string
  /** Optional description. */
  description?: string
}

/** Input for adding one key result. */
export interface AddKeyResultInput {
  /** Owning objective's id. */
  objectiveId: string
  /** Key result name. */
  name: string
  /** Optional metric name. */
  metric?: string
  /** Optional target value. */
  target?: string
}

/** Input for adding one evidence row. */
export interface AddEvidenceInput {
  /** Owning objective's id. */
  objectiveId: string
  /** Optional owning key result's id. */
  krId?: string
  /** Session the evidence came from. */
  sessionId: string
  /** Sequence number of the source event. */
  seq: number
  /** Discriminant of the source event. */
  eventType: string
  /** Model-visible excerpt. */
  excerpt: string
  /** Timestamp of the source event in Unix epoch milliseconds. */
  time: number
}

/** Result of one autobuilder run over a session log. */
export interface GraphBuildResult {
  /** Session that was ingested. */
  sessionId: string
  /** Objectives created by this run (idempotent replays add none). */
  objectivesCreated: number
  /** Evidence rows added by this run (idempotent replays add none). */
  evidenceAdded: number
}

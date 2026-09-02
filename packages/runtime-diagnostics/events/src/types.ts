/**
 * Typed event vocabulary of the runtime diagnostic stream.
 *
 * Every runtime signal the harness cares about — tool calls, model calls,
 * judge votes, budget state, compaction — is captured as one discriminated
 * event. The stream that carries them is append-only within a session fold;
 * alarms and verifiers read the replayable projection, never the live buffer.
 *
 * ## Golden rule
 *
 * These events are a diagnostic PROJECTION derived from the log by a pure
 * fold. They never mutate model-visible history; a deep-frozen projection
 * throws on mutation. `seq` is monotonic within one fold and every event is
 * immutable once appended.
 *
 * @module @atlasai/atsh-runtime-events/src/types
 */

/** One runtime signal kind, drawn from the typed event set. */
export type RuntimeEventKind =
  | 'tool/call'
  | 'model/call'
  | 'judge/vote'
  | 'budget/state'
  | 'compaction'

/** Base fields shared by every typed runtime event. */
export interface RuntimeEventBase {
  /** Discriminant that selects the concrete event shape. */
  readonly kind: RuntimeEventKind
  /** Monotonic sequence within one fold; strictly increasing. */
  readonly seq: number
  /** Epoch milliseconds when the source emitted the signal. */
  readonly ts: number
}

/** A tool call completed by the runtime. */
export interface ToolCallEvent extends RuntimeEventBase {
  readonly kind: 'tool/call'
  /** Canonical tool name, e.g. `fs_read`. */
  readonly tool: string
  /** Optional compact input summary — never the full payload. */
  readonly input?: string
}

/** A model (LLM) call made by the runtime. */
export interface ModelCallEvent extends RuntimeEventBase {
  readonly kind: 'model/call'
  /** Model identifier, e.g. `deepseek-v4-flash`. */
  readonly model: string
  /** Input tokens reported by the provider, when known. */
  readonly inputTokens?: number
  /** Output tokens reported by the provider, when known. */
  readonly outputTokens?: number
}

/** One judge voter's ballot on a fixture under review. */
export interface JudgeVoteEvent extends RuntimeEventBase {
  readonly kind: 'judge/vote'
  /** Roster member id, e.g. `panel-a`. */
  readonly voter: string
  /** The verdict this voter cast. */
  readonly vote: 'pass' | 'fail' | 'replan'
  /** Optional evidence attached to the ballot (never averaged). */
  readonly evidence?: string
}

/** A budget state transition or route decision. */
export interface BudgetStateEvent extends RuntimeEventBase {
  readonly kind: 'budget/state'
  /** The state or transition observed, e.g. `route` or `veto`. */
  readonly state: string
  /** Remaining budget units at this transition, when known. */
  readonly remaining?: number
}

/** A compaction pass over the conversation surface. */
export interface CompactionEvent extends RuntimeEventBase {
  readonly kind: 'compaction'
  /** The compaction mode applied, e.g. `verbatim` or `summarize`. */
  readonly mode: string
  /** Bytes retained on this surface after the pass. */
  readonly retainedBytes?: number
}

/** The closed-union event set emitted by runtime signal sources. */
export type RuntimeEvent =
  | ToolCallEvent
  | ModelCallEvent
  | JudgeVoteEvent
  | BudgetStateEvent
  | CompactionEvent


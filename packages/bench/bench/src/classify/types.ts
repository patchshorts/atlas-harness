/**
 * Public types for the bench classifier (`bench-classify`): deterministic
 * C1..C5 correction-class rules over the exported append-only session log.
 *
 * The input is the harness `SessionEvent` envelope exported as JSON with
 * `type` and `seq` intact (benchmark spec §3): every event carries
 * `{ type, seq, time, data }` plus optional surface metadata. The classifier
 * never modifies the log — it is a read-only pure function.
 *
 * @module @atlasai/atsh-bench/classify
 */

/** The five correction classes (benchmark spec §2.1). */
export type CorrectionClass = 'C1' | 'C2' | 'C3' | 'C4' | 'C5'

/** One event in the exported session log — the `SessionEvent` envelope. */
export interface SessionLogEvent {
  /** Event kind, e.g. `tool/call`, `tool/result`, `assistant/message`, `user/message`, `todo/write`. */
  type: string
  /** Monotonic sequence number within the session. */
  seq: number
  /** Unix epoch milliseconds (optional in re-exported fixtures). */
  time?: number
  /** The event payload — `SessionEventMap[type]`. */
  data: Record<string, unknown>
}

/**
 * Classifier configuration. The lexicon is a config row, not code: it is
 * frozen in bench-manifest.json before any session runs (spec §2.2) and the
 * runner (T5) passes the frozen row through {@link loadConfigFromManifest}.
 */
export interface ClassifierConfig {
  /** C3/C5 keyword list, matched on lowercase message text (spec §2.2). */
  lexicon: string[]
  /** C1: same-tool retry must occur within this many events of the erroring `tool/result`. */
  c1RetryWindow: number
  /** C5: a qualifying user message must occur within this many events after an assistant action. */
  c5AssistantWindow: number
  /** C5/§2.3: user messages longer than this many chars are task prose, never corrections. */
  userMessageMaxChars: number
  /** Tool names whose call writes file content (C2 payload family). */
  fsWriteFamily: string[]
  /** Tool names whose call edits file content (C2 payload family). */
  fsEditFamily: string[]
}

/** One counted correction with its log evidence, for auditability. */
export interface CorrectionHit {
  /** The correction class. */
  class: CorrectionClass
  /** Seq of the classifying event (the retry call for C1, the restoring write for C2, the message for C3/C5, the flip for C4). */
  seq: number
  /** One-line evidence note naming the involved tool/path/token. */
  note: string
}

/** Per-class correction counts for one session. */
export interface ClassificationCounts {
  C1: number
  C2: number
  C3: number
  C4: number
  C5: number
}

/** The full classification result for one session. */
export interface ClassificationResult {
  /** Session id when the input carried one (the `{ events, sessionId }` shape). */
  sessionId?: string
  /** Number of events classified. */
  events: number
  /** Number of `tool/call` events in the log. */
  toolCalls: number
  /** Per-class counts. */
  counts: ClassificationCounts
  /** C1 + C2 + C3 + C4 + C5. */
  total: number
  /** `total / toolCalls * 100` — corrections per 100 tool calls (0 when no calls). */
  per100Calls: number
  /** Every counted correction with seq evidence, ascending seq order. */
  hits: CorrectionHit[]
}

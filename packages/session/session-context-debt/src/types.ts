/**
 * @atlasai/atsh-session-context-debt — public types.
 *
 * Context-debt management is a read-only discipline: every shape here
 * describes a *derived* view of committed session events (a report, a scan,
 * a fold-only compaction plan). None of these types can represent a log
 * mutation — {@link CompactionPlan.foldOnly} is hard-typed to `true`.
 */

/** The three context-debt failure modes this package detects and plans around. */
export type ContextDebtKind = 'stuffed' | 'unretrieved' | 'positioned'

/** One detected context-debt item. */
export interface ContextDebtReport {
  /** The session the report was produced for ('' when produced by a pure fold). */
  sessionId: string
  /** Which debt mode the report describes. */
  kind: ContextDebtKind
  /** Tokens or count depending on `kind` (tokens for `stuffed` and `positioned`). */
  measure: number
  /** One-line explanation; includes the affected seq span when known. */
  detail: string
}

/** The full result of one {@link ContextDebtService.scan} over a session. */
export interface ContextDebtScan {
  /** The session that was scanned. */
  sessionId: string
  /** Every detected debt item, deterministic per committed snapshot. */
  reports: ContextDebtReport[]
  /** The log seq the scan reflects (the last committed seq, -1 for an empty log). */
  foldSeq: number
}

/** A fold-only compaction plan: a derived summary that never rewrites the log. */
export interface CompactionPlan {
  /** The session the plan was derived from. */
  sessionId: string
  /** The derived summary text (fold output over committed events). */
  summary: string
  /** The shadowed event span, inclusive, in seq space. */
  shadowedRange: { start: number; end: number }
  /** The committed seqs the summary shadows; all within the committed range. */
  shadowedSeqs: number[]
  /** Estimated tokens of the shadowed content. */
  shadowedTokenCount: number
  /** Hard `true`: this plan NEVER rewrites the log (golden rule). */
  foldOnly: true
}

/** Mount-time configuration for {@link ContextDebtService}. */
export interface ContextDebtConfig {
  /** Master switch; when false, scan/plan throw `'context-debt disabled'`. Default true. */
  enabled?: boolean
  /** Non-essential context tokens that trigger a `stuffed` report. Default 20000. */
  stuffedThresholdTokens?: number
  /** Token budget for the critical head band. Default 2000. */
  positionalHeadTokens?: number
  /** Token budget for the critical tail band. Default 2000. */
  positionalTailTokens?: number
}

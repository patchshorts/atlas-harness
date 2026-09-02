/**
 * Typed alarm vocabulary emitted by the runtime-diagnostics alarm detectors.
 *
 * An alarm is a derived SIGNAL, never a mutation: a detector folds over the
 * replayable event stream and returns alarm objects. Detectors are pure —
 * they never write to the stream, never mutate an event, and never re-emit by
 * double-consume (a single fold per detector; the cursor is monotonic inside
 * the fold, so the same event is never counted twice).
 *
 * @module @atlasai/atsh-runtime-alarms/src/types
 */

/** The closed set of alarm kinds the detectors can raise. */
export type AlarmKind =
  | 'p-ratio'
  | 'evidence-deficit'
  | 'repeated-call'

/** Machine-readable severity of an alarm. */
export type AlarmSeverity = 'info' | 'warning' | 'critical'

/**
 * A single alarm signal derived from the event stream.
 *
 * `seq` names the first stream event that triggered the alarm; consumers use
 * it to correlate the alarm back to the exact point in the replayable fold.
 */
export interface Alarm {
  /** Stable discriminator selecting the alarm kind. */
  readonly kind: AlarmKind
  /** Severity of the condition. */
  readonly severity: AlarmSeverity
  /** Sequence number of the triggering stream event. */
  readonly seq: number
  /** Human-readable, evidence-carrying message. */
  readonly message: string
}

/** Options accepted by the P-Ratio detector. */
export interface PRatioOptions {
  /**
   * Output fraction below which the detector raises.
   *
   * P-Ratio = output tokens / (input + output tokens) across the window.
   * A value below `minOutputFraction` means the runtime is burning input
   * tokens without producing proportional output — an efficiency collapse.
   * @default 0.15
   */
  readonly minOutputFraction?: number
}

/** Options accepted by the evidence-deficit detector. */
export interface EvidenceDeficitOptions {
  /**
   * Minimum evidence length (chars) a judge vote must carry.
   *
   * The three-panel contract is unanimity WITH evidence-based dissent, never
   * averaged votes; a ballot with no evidence cannot carry that contract.
   * @default 1
   */
  readonly minEvidenceChars?: number
}

/** Options accepted by the repeated-call detector. */
export interface RepeatedCallOptions {
  /**
   * Consecutive identical tool-call count that triggers the alarm.
   *
   * N calls of the SAME tool with no intervening different event means the
   * runtime is looping on one tool without progress.
   * @default 3
   */
  readonly repeatThreshold?: number
  /**
   * Only count a run of identical calls as consecutive when no other event
   * kind appears between them. When `false`, a run is a sequence of the same
   * tool with any events interleaved.
   * @default true
   */
  readonly strictConsecutive?: boolean
}

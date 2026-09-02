/**
 * Public types for `bench-audit` — the classifier second-pass audit
 * (benchmark spec §6.4). The deterministic C1..C5 classifier is applied a
 * SECOND time to the exported session logs, and the resulting counts are
 * compared against the counts recorded at run time (first pass). Agreement
 * is the fraction of classification cells (5 per session) that match; the
 * spec target is >= 0.95.
 *
 * A missing session log is the honest conservative reading: the row gets
 * `logFound: false`, `classMatches: 0`, and still contributes 5 cells (all
 * mismatched) so missing logs can never inflate agreement.
 *
 * @module @atlasai/atsh-bench/audit
 */

import type { BenchArm } from '../run/run.ts'
import type { ClassificationCounts } from '../classify/types.ts'

/** One audited session: recorded (first pass) vs reclassified (second pass). */
export interface AuditSessionRow {
  /** Task id — pairs the counts-artifact row with its `<taskId>.jsonl` log. */
  taskId: string
  /** Session id recorded in the counts artifact (absent on old artifacts). */
  sessionId?: string
  /** Counts recorded at run time (first pass, from `counts-<arm>.json`). */
  recorded: ClassificationCounts
  /** Counts from re-classifying the exported log (second pass). */
  reclassified: ClassificationCounts
  /** Number of equal classes C1..C5 (0..5). */
  classMatches: number
  /** False when the session log file was missing (conservative mismatch). */
  logFound: boolean
}

/** One arm of the audit: per-session rows plus cell-level agreement. */
export interface AuditArmResult {
  arm: BenchArm
  sessions: AuditSessionRow[]
  /** Task ids whose `<taskId>.jsonl` log was not found. */
  missingLogs: string[]
  /** Total classification cells compared (5 per session, including missing logs). */
  classCells: number
  /** Cells where the recorded count equals the reclassified count. */
  matchedCells: number
  /** `matchedCells / classCells`; 0 when there are no cells. */
  agreement: number
  /** Fraction of sessions with `classMatches === 5` (0..1). */
  sessionsAgree: number
}

/** Per-class agreement cells, summed across both arms. */
export interface AuditPerClassCell {
  cells: number
  matched: number
}

/** The complete classifier audit report (serialized as classifier-audit.json). */
export interface AuditReport {
  arms: AuditArmResult[]
  /** Weighted agreement across arms: `sum(matchedCells) / sum(classCells)`; 0 when no cells. */
  overall: number
  /** Per-class cells + matched, summed across both arms. */
  perClass: Record<'C1' | 'C2' | 'C3' | 'C4' | 'C5', AuditPerClassCell>
  /** The spec §6.4 agreement target. */
  target: number
  /** True when `overall >= target` (0.95). */
  pass: boolean
  /** ISO generation timestamp. */
  generatedAt: string
}

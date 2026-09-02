/**
 * Public types for `bench-report` — the paired comparison report over the
 * runner's per-arm artifacts (benchmark spec §6, §7, §10).
 *
 * The report consumes the artifacts the runner (T5) already writes per arm:
 * `counts-<arm>.json` (per-task classification counts + success), the
 * `cost-<arm>.json` sidecar (spec §7), and the shared `run.log` header
 * (fingerprint + model pin + manifest hash, spec §9). Sessions are paired
 * BY TASK ID; the per-task delta is `additive - clone` so that a NEGATIVE
 * delta means the additive arm corrected less (spec §6.1's pass direction).
 *
 * All report values are computed deterministically (no `Math.random`, no
 * clock in the output) — the same artifacts always produce the same report.
 *
 * @module @atlasai/atsh-bench/report
 */

import type { BenchArm, RunFingerprint } from '../run/run.ts'
import type { ClassificationCounts, CorrectionHit } from '../classify/types.ts'
import type { TurnAggregate } from './stats.ts'

/** The on-disk `counts-<arm>.json` artifact shape (written by the runner). */
export interface CountsArtifact {
  arm: BenchArm
  /** ISO run timestamp recorded by the runner. */
  run: string
  sessions: CountsSession[]
  meanCorrections: number
  per100Calls: number
  successRate: number | null
}

/** One session row inside a `counts-<arm>.json` artifact. */
export interface CountsSession {
  taskId: string
  sessionId?: string
  exitCode: number
  timedOut: boolean
  taskSuccess: boolean | null
  events: number
  toolCalls: number
  counts: ClassificationCounts
  total: number
  per100Calls: number
  hits: CorrectionHit[]
  /** Per-turn waste-ratio segments (broaden-design §4.5); absent on old
   *  artifacts / when a session ran no tool-calling turn. */
  turns?: TurnSegments[]
}

/** One per-turn waste-ratio segment serialized into a artifact row (§4.5). */
export interface TurnSegments {
  turn: number
  totalCalls: number
  wastedCalls: number
  wasteRatio: number
}

/** The on-disk `cost-<arm>.json` artifact shape (spec §7). */
export interface CostArtifact {
  arm: BenchArm
  prices: { uncachedInputPerMTok: number; cachedInputPerMTok: number; outputPerMTok: number }
  sessions: Array<{
    taskId: string
    inputTokens: number
    cachedInputTokens: number
    cacheWriteTokens: number
    uncachedInputTokens: number
    outputTokens: number
    cacheHitRate: number
    usd: number
    usageEvents: number
    missingUsageEvents: number
  }>
  meanCostUsd: number
  meanCacheHitRate: number
}

/** Per-arm aggregates reported from the artifacts (runner-computed values). */
export interface ArmAggregate {
  arm: BenchArm
  /** Sessions present in the arm's counts artifact. */
  sessions: number
  meanCorrections: number
  per100Calls: number
  successRate: number | null
  meanCostUsd: number
  meanCacheHitRate: number
  /** Summed C1..C5 counts across the arm's sessions. */
  totals: ClassificationCounts
  /** Mean C1..C5 counts per session. */
  perSession: ClassificationCounts
}

/** One row of the paired per-task table (spec §10). */
export interface PairedTaskRow {
  taskId: string
  /** Suite class derived from the taskId prefix (memory/debug/coordination/reserve/other). */
  taskClass: TaskClass
  /** `null` when the task ran only on the additive arm. */
  cloneCorrections: number | null
  /** `null` when the task ran only on the clone arm. */
  additiveCorrections: number | null
  /** `additive - clone`; `null` for unpaired tasks (spec: blank delta). */
  delta: number | null
  clonePer100Calls: number | null
  additivePer100Calls: number | null
  cloneSuccess: boolean | null
  additiveSuccess: boolean | null
}

/** Suite task class, derived from the taskId prefix (spec §2.4 secondary axis). */
export type TaskClass = 'memory' | 'debug' | 'coordination' | 'reserve' | 'other'

/** Resolve a task's suite class from its task id prefix. Grouping: mem → memory,
 *  dbg → debug, coord|crit → coordination, rv → reserve; every other prefix (res,
 *  ref, grn, hrd, lume, signal) → other. */
export function taskClassOf(taskId: string): TaskClass {
  const match = /^([a-z]+)-/.exec(taskId)
  const prefix = match?.[1] ?? ''
  switch (prefix) {
    case 'mem': return 'memory'
    case 'dbg': return 'debug'
    case 'coord':
    case 'crit': return 'coordination'
    case 'rv': return 'reserve'
    default: return 'other'
  }
}

/** Cost sidecar spec block per arm (spec §7) — means with 95% CIs. */
export interface CostSidecarBlock {
  arm: BenchArm
  /** Sessions in the arm's cost artifact. */
  sessions: number
  meanCachedTokens: number
  cachedTokensCi: [number, number] | null
  meanUncachedTokens: number
  uncachedTokensCi: [number, number] | null
  meanCostUsd: number
  costUsdCi: [number, number] | null
  meanCacheHitRate: number
  cacheHitRateCi: [number, number] | null
}

/** Significance + confidence-interval block (spec §6.1, §7). */
export interface SignificanceResult {
  /** Tasks present in BOTH arms' artifacts. */
  pairedCount: number
  /** Paired tasks whose delta is zero — excluded from the signed-rank test. */
  zeroDropped: number
  unpairedClone: number
  unpairedAdditive: number
  wilcoxon: WilcoxonResult
  /** One-sided signed-rank on the per-100-call correction base (call-volume
   *  confound control: arms differ in tool-call volume). */
  per100Wilcoxon: WilcoxonResult
  /** Mean of per-task `additive - clone` over paired tasks (raw totals). */
  meanDelta: number
  /** Mean of per-task `additive - clone` per-100-call over paired tasks. */
  meanPer100Delta: number
  /** 95% CI for the mean delta (t-based); null with fewer than 2 pairs. */
  meanDeltaCi: [number, number] | null
  pairedT: PairedTResult
  mcNemar: McNemarResult
  /** Per-class (memory/debug/coordination/reserve/other) one-sided signed-rank
   *  on the per-100-call base, alongside the pooled test (spec §2.4 secondary). */
  classStratified: ClassStratum[]
}

/** One suite-class stratum of the per-100-call signed-rank table. */
export interface ClassStratum {
  taskClass: TaskClass
  /** Paired tasks in this class present in BOTH arms. */
  pairedCount: number
  /** Zero-delta tasks in this class — excluded from the signed-rank test. */
  zeroDropped: number
  /** Mean per-task `additive - clone` per-100-call over this class's pairs. */
  meanPer100Delta: number
  /** One-sided signed-rank (additive < clone) on the per-100-call base. */
  wilcoxon: WilcoxonResult
}

/** One-sided Wilcoxon signed-rank result (H1: additive corrections < clone). */
export interface WilcoxonResult {
  /** W+ — sum of positive ranks over `clone - additive` differences. */
  statistic: number
  /** One-sided p: P(W+ >= statistic) under H0 (median difference = 0). */
  pValue: number
  /** Non-zero differences after dropping zero deltas. */
  nEffective: number
  /**
   * Method used: `exact` DP over the rank-sum distribution (n <= 30, no ties);
   * `normal-approximation` tie-corrected z with continuity correction;
   * `degenerate` when there are no non-zero differences.
   */
  method: 'exact' | 'normal-approximation' | 'degenerate'
  /** True when |differences| contained tied values (average ranks used). */
  tieCorrected: boolean
}

/** One-sided paired t-test result (sensitivity check, spec §5). */
export interface PairedTResult {
  tStatistic: number
  /** One-sided p: P(T >= tStatistic) under H0 (mean difference = 0). */
  pValue: number
  /** Degrees of freedom: paired tasks - 1 (0 when no pairs). */
  df: number
}

/** McNemar's test on the paired success table (spec §6.2). */
export interface McNemarResult {
  /** Clone success, additive failure (regression cell). */
  b: number
  /** Clone failure, additive success (improvement cell). */
  c: number
  /** Exact two-sided binomial p over discordant cells. */
  exactP: number
  /** Continuity-corrected chi-square statistic; null with no discordant cells. */
  chiSquare: number | null
  /** Chi-square p (df = 1); null with no discordant cells. */
  chiSquareP: number | null
}

/** Pass/fail status of one spec §6 criterion. */
export type CriterionStatus = 'PASS' | 'FAIL' | 'PENDING'

/** One spec §6 criterion evaluation. */
export interface CriterionResult {
  criterion: 1 | 2 | 3 | 4
  status: CriterionStatus
  /** Machine-readable outcome sentence — numbers only, never adjectives. */
  detail: string
  /** The measured values that feed the criterion. */
  values: Record<string, number | string | null>
}

/** The complete benchmark report (serialized as bench-results.json). */
export interface BenchReport {
  iteration: number
  manifestSha256: string | null
  modelPin: { model: string; temperature: number; maxTokens: number } | null
  fingerprint: RunFingerprint | null
  /** Classifier audit agreement (spec §6.4), 0..1; null = not supplied. */
  auditAgreement: number | null
  /** ISO run timestamps from the artifacts (spec §10 header timestamps). */
  cloneRunAt: string | null
  additiveRunAt: string | null
  arms: { clone: ArmAggregate; additive: ArmAggregate }
  /** Paired rows sorted by task id; includes unpaired tasks with blank deltas. */
  pairedTasks: PairedTaskRow[]
  pairedCount: number
  unpairedClone: string[]
  unpairedAdditive: string[]
  /** Per-class counts, summed per arm (spec §2.4 secondary metric). */
  perClass: { clone: ClassificationCounts; additive: ClassificationCounts }
  perClassPerSession: { clone: ClassificationCounts; additive: ClassificationCounts }
  cost: { clone: CostSidecarBlock; additive: CostSidecarBlock }
  significance: SignificanceResult
  /** Per-turn waste-ratio aggregate per arm (broaden-design §4.5 n-gain). Null
   *  when neither artifact carries turn data (e.g. pre-T6 re-runs). */
  turnAggregate: { clone: TurnAggregate | null; additive: TurnAggregate | null }
  criteria: [CriterionResult, CriterionResult, CriterionResult, CriterionResult]
  /** PASS iff all four criteria PASS; FAIL iff any FAIL; else PENDING. */
  overall: 'PASS' | 'FAIL' | 'PENDING'
}

/** Options for {@link buildReport}. */
export interface ReportOptions {
  /** Directory holding `counts-clone.json` + `cost-clone.json`. */
  cloneDir: string
  /** Directory holding `counts-additive.json` + `cost-additive.json`. */
  additiveDir: string
  /** Path to the shared `run.log` (or its directory); optional header source. */
  manifest?: string
  /** Classifier audit agreement 0..1 (spec §6.4); undefined = PENDING. */
  auditAgreement?: number
  /** Iteration number for the report header (default 1). */
  iteration?: number
}

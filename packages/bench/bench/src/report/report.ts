/**
 * `bench-report` builder — assemble the paired comparison report from the
 * runner's per-arm artifacts (benchmark spec §6, §7, §10).
 *
 * Inputs (written by `bench-run`, T5):
 * - `<cloneDir>/counts-clone.json` + `<cloneDir>/cost-clone.json`
 * - `<additiveDir>/counts-additive.json` + `<additiveDir>/cost-additive.json`
 * - optionally the shared `run.log` header (fingerprint + model pin +
 *   manifest hash) via the `manifest` option.
 *
 * Sessions are paired BY TASK ID. Tasks present in one arm only appear in
 * the paired table with their own counts and a blank delta, and are EXCLUDED
 * from the Wilcoxon / paired-t / McNemar pairing. The report is fully
 * deterministic: the same artifacts produce the same report (no clock, no
 * randomness — the only timestamps are those the runner recorded).
 *
 * @module @atlasai/atsh-bench/report/report
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  computeTurnAggregate,
  meanConfidenceInterval,
  mcNemar,
  pairedTOneSided,
  wilcoxonSignedRankOneSided,
} from './stats.ts'
import { taskClassOf } from './types.ts'
import type {
  ArmAggregate,
  BenchReport,
  ClassStratum,
  CostArtifact,
  CostSidecarBlock,
  CountsArtifact,
  CountsSession,
  CriterionResult,
  PairedTaskRow,
  ReportOptions,
  SignificanceResult,
  TaskClass,
} from './types.ts'
import type { BenchArm, RunFingerprint } from '../run/run.ts'

/** Read + validate a `counts-<arm>.json` artifact. */
export function loadCountsFile(dir: string, arm: BenchArm): CountsArtifact {
  const path = join(dir, `counts-${arm}.json`)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`bench-report: cannot read counts artifact ${path}: ${(error as Error).message}`)
  }
  const artifact = parsed as Partial<CountsArtifact>
  if (!Array.isArray(artifact.sessions)) {
    throw new Error(`bench-report: counts artifact ${path} has no sessions array`)
  }
  for (const session of artifact.sessions) {
    const row = session as Partial<CountsSession>
    if (typeof row.taskId !== 'string' || typeof row.total !== 'number') {
      throw new Error(`bench-report: counts artifact ${path} has a session without taskId/total`)
    }
  }
  return artifact as CountsArtifact
}

/** Read + validate a `cost-<arm>.json` artifact (spec §7). */
export function loadCostFile(dir: string, arm: BenchArm): CostArtifact {
  const path = join(dir, `cost-${arm}.json`)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`bench-report: cannot read cost artifact ${path}: ${(error as Error).message}`)
  }
  const artifact = parsed as Partial<CostArtifact>
  if (!Array.isArray(artifact.sessions)) {
    throw new Error(`bench-report: cost artifact ${path} has no sessions array`)
  }
  for (const session of artifact.sessions) {
    if (typeof session.taskId !== 'string' || typeof session.usd !== 'number') {
      throw new Error(`bench-report: cost artifact ${path} has a session without taskId/usd`)
    }
  }
  return artifact as CostArtifact
}

/**
 * Read the run-start header from the shared run log (spec §5, §9): first
 * line is `{event: 'run-start', fingerprint, pin, manifestSha256}`. Accepts
 * the run.log file path or its directory. Missing/unparsable input yields
 * nulls — the header is optional context, never a hard failure.
 *
 * @param manifest - path to run.log (or the directory containing it).
 * @returns the header fields (null when unavailable).
 */
export function loadRunLogHeader(manifest: string): {
  fingerprint: RunFingerprint | null
  pin: { model: string; temperature: number; maxTokens: number } | null
  manifestSha256: string | null
} {
  let path = manifest
  try {
    if (statSync(path).isDirectory()) path = join(path, 'run.log')
  } catch {
    return { fingerprint: null, pin: null, manifestSha256: null }
  }
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { fingerprint: null, pin: null, manifestSha256: null }
  }
  const candidates = [text.split('\n').find(line => line.trim() !== '') ?? '', text]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        event?: unknown
        fingerprint?: unknown
        pin?: unknown
        manifestSha256?: unknown
      }
      if (parsed.event === 'run-start') {
        return {
          fingerprint: (parsed.fingerprint as RunFingerprint | undefined) ?? null,
          pin: (parsed.pin as { model: string; temperature: number; maxTokens: number } | undefined) ?? null,
          manifestSha256: typeof parsed.manifestSha256 === 'string' ? parsed.manifestSha256 : null,
        }
      }
    } catch {
      // Not JSON — try the whole-file candidate next.
    }
  }
  return { fingerprint: null, pin: null, manifestSha256: null }
}

/** Sum one classification-count field over sessions. */
function sumCounts(sessions: readonly CountsSession[], field: 'C1' | 'C2' | 'C3' | 'C4' | 'C5'): number {
  return sessions.reduce((sum, session) => sum + session.counts[field], 0)
}

/** Per-arm aggregate from the two artifacts. */
function armAggregate(arm: BenchArm, counts: CountsArtifact, cost: CostArtifact): ArmAggregate {
  const sessions = counts.sessions
  return {
    arm,
    sessions: sessions.length,
    meanCorrections: counts.meanCorrections,
    per100Calls: counts.per100Calls,
    successRate: counts.successRate,
    meanCostUsd: cost.meanCostUsd,
    meanCacheHitRate: cost.meanCacheHitRate,
    totals: {
      C1: sumCounts(sessions, 'C1'),
      C2: sumCounts(sessions, 'C2'),
      C3: sumCounts(sessions, 'C3'),
      C4: sumCounts(sessions, 'C4'),
      C5: sumCounts(sessions, 'C5'),
    },
    perSession: {
      C1: sessions.length > 0 ? sumCounts(sessions, 'C1') / sessions.length : 0,
      C2: sessions.length > 0 ? sumCounts(sessions, 'C2') / sessions.length : 0,
      C3: sessions.length > 0 ? sumCounts(sessions, 'C3') / sessions.length : 0,
      C4: sessions.length > 0 ? sumCounts(sessions, 'C4') / sessions.length : 0,
      C5: sessions.length > 0 ? sumCounts(sessions, 'C5') / sessions.length : 0,
    },
  }
}

/** Cost sidecar spec block for one arm (spec §7) — means with 95% CIs. */
function costBlock(arm: BenchArm, cost: CostArtifact): CostSidecarBlock {
  const cached = cost.sessions.map(session => session.cachedInputTokens)
  const uncached = cost.sessions.map(session => session.uncachedInputTokens)
  const usd = cost.sessions.map(session => session.usd)
  const hitRate = cost.sessions.map(session => session.cacheHitRate)
  return {
    arm,
    sessions: cost.sessions.length,
    meanCachedTokens: meanConfidenceInterval(cached).mean,
    cachedTokensCi: meanConfidenceInterval(cached).ci,
    meanUncachedTokens: meanConfidenceInterval(uncached).mean,
    uncachedTokensCi: meanConfidenceInterval(uncached).ci,
    meanCostUsd: meanConfidenceInterval(usd).mean,
    costUsdCi: meanConfidenceInterval(usd).ci,
    meanCacheHitRate: meanConfidenceInterval(hitRate).mean,
    cacheHitRateCi: meanConfidenceInterval(hitRate).ci,
  }
}

/** Compare task ids for the deterministic sorted paired table. */
function byTaskId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Build the full benchmark report from two arm directories (spec §10).
 *
 * Criterion evaluation (spec §6):
 * 1. primary: one-sided Wilcoxon p < 0.05 AND the mean delta (additive -
 *    clone) is negative;
 * 2. no task-success regression: additive success rate >= clone rate - 5
 *    percentage points AND McNemar exact p >= 0.05;
 * 3. quality gate: BOTH arms >= 60% task success;
 * 4. classifier audit: `auditAgreement >= 0.95`; when `auditAgreement` is
 *    not supplied the criterion is marked PENDING.
 *
 * @param options - arm directories + optional header/audit context.
 * @returns the report (deterministic for the same artifacts).
 */
export function buildReport(options: ReportOptions): BenchReport {
  const iteration = options.iteration ?? 1
  if (!Number.isInteger(iteration) || iteration < 1) {
    throw new Error(`bench-report: iteration must be a positive integer, got ${iteration}`)
  }
  if (options.auditAgreement !== undefined && !(options.auditAgreement >= 0 && options.auditAgreement <= 1)) {
    throw new Error(`bench-report: audit agreement must be in [0, 1], got ${options.auditAgreement}`)
  }
  const cloneCounts = loadCountsFile(options.cloneDir, 'clone')
  const cloneCost = loadCostFile(options.cloneDir, 'clone')
  const additiveCounts = loadCountsFile(options.additiveDir, 'additive')
  const additiveCost = loadCostFile(options.additiveDir, 'additive')

  const header = options.manifest !== undefined ? loadRunLogHeader(options.manifest) : null

  const cloneByTask = new Map(cloneCounts.sessions.map(session => [session.taskId, session]))
  const additiveByTask = new Map(additiveCounts.sessions.map(session => [session.taskId, session]))
  const allTaskIds = [...new Set([...cloneByTask.keys(), ...additiveByTask.keys()])].sort(byTaskId)

  const pairedTasks: PairedTaskRow[] = []
  const unpairedClone: string[] = []
  const unpairedAdditive: string[] = []
  for (const taskId of allTaskIds) {
    const cloneSession = cloneByTask.get(taskId)
    const additiveSession = additiveByTask.get(taskId)
    if (cloneSession !== undefined && additiveSession !== undefined) {
      pairedTasks.push({
        taskId,
        taskClass: taskClassOf(taskId),
        cloneCorrections: cloneSession.total,
        additiveCorrections: additiveSession.total,
        delta: additiveSession.total - cloneSession.total,
        clonePer100Calls: cloneSession.per100Calls,
        additivePer100Calls: additiveSession.per100Calls,
        cloneSuccess: cloneSession.taskSuccess,
        additiveSuccess: additiveSession.taskSuccess,
      })
    } else if (cloneSession !== undefined) {
      unpairedClone.push(taskId)
      pairedTasks.push({
        taskId,
        taskClass: taskClassOf(taskId),
        cloneCorrections: cloneSession.total,
        additiveCorrections: null,
        delta: null,
        clonePer100Calls: cloneSession.per100Calls,
        additivePer100Calls: null,
        cloneSuccess: cloneSession.taskSuccess,
        additiveSuccess: null,
      })
    } else {
      unpairedAdditive.push(taskId)
      if (additiveSession === undefined) {
        throw new Error(`bench-report: task ${taskId} has neither a clone nor an additive session`)
      }
      pairedTasks.push({
        taskId,
        taskClass: taskClassOf(taskId),
        cloneCorrections: null,
        additiveCorrections: additiveSession.total,
        delta: null,
        clonePer100Calls: null,
        additivePer100Calls: additiveSession.per100Calls,
        cloneSuccess: null,
        additiveSuccess: additiveSession.taskSuccess,
      })
    }
  }

  const paired = pairedTasks.filter(
    (row): row is PairedTaskRow & { cloneCorrections: number; additiveCorrections: number; delta: number } =>
      row.delta !== null && row.cloneCorrections !== null && row.additiveCorrections !== null,
  )
  const cloneTotals = paired.map(row => row.cloneCorrections)
  const additiveTotals = paired.map(row => row.additiveCorrections)
  const deltas = paired.map(row => row.delta)

  const wilcoxon = wilcoxonSignedRankOneSided(cloneTotals, additiveTotals)

  // Per-100-call base (call-volume confound control): every paired session with
  // both per-100-call values contributes its clone/additive rate; a task whose
  // per-100-call value is missing on either arm is excluded from this test (the
  // pooled deltas similarly pair only tasks present in both arms' artifacts).
  const per100Members = paired.filter(
    row => row.clonePer100Calls !== null && row.additivePer100Calls !== null,
  )
  const clonePer100 = per100Members.map(row => row.clonePer100Calls as number)
  const additivePer100 = per100Members.map(row => row.additivePer100Calls as number)
  const per100Deltas = per100Members.map(row => (row.additivePer100Calls as number) - (row.clonePer100Calls as number))
  const per100Wilcoxon = wilcoxonSignedRankOneSided(clonePer100, additivePer100)
  const meanPer100Delta = per100Deltas.length > 0
    ? per100Deltas.reduce((sum, d) => sum + d, 0) / per100Deltas.length
    : 0

  // Class-stratified signed-rank on the per-100-call base (spec §2.4 secondary).
  // Deterministic class order: memory, debug, coordination, reserve, other.
  const CLASS_ORDER: readonly TaskClass[] = ['memory', 'debug', 'coordination', 'reserve', 'other']
  const classStratified: ClassStratum[] = []
  for (const taskClass of CLASS_ORDER) {
    const members = per100Members.filter(row => row.taskClass === taskClass)
    if (members.length === 0) continue
    const c = members.map(row => row.clonePer100Calls as number)
    const a = members.map(row => row.additivePer100Calls as number)
    const d = members.map(row => (row.additivePer100Calls as number) - (row.clonePer100Calls as number))
    const stratumWilcoxon = wilcoxonSignedRankOneSided(c, a)
    classStratified.push({
      taskClass,
      pairedCount: members.length,
      zeroDropped: members.length - stratumWilcoxon.nEffective,
      meanPer100Delta: d.reduce((sum, x) => sum + x, 0) / d.length,
      wilcoxon: stratumWilcoxon,
    })
  }

  const pairedT = pairedTOneSided(cloneTotals, additiveTotals)
  const meanDelta = deltas.length > 0 ? deltas.reduce((sum, d) => sum + d, 0) / deltas.length : 0
  const meanDeltaCi = meanConfidenceInterval(deltas).ci
  const successRows = paired
    .filter(row => row.cloneSuccess !== null && row.additiveSuccess !== null)
    .map(row => ({ cloneSuccess: row.cloneSuccess as boolean, additiveSuccess: row.additiveSuccess as boolean }))
  const mcnemar = mcNemar(successRows)

  const significance: SignificanceResult = {
    pairedCount: paired.length,
    zeroDropped: paired.length - wilcoxon.nEffective,
    unpairedClone: unpairedClone.length,
    unpairedAdditive: unpairedAdditive.length,
    wilcoxon,
    per100Wilcoxon,
    meanDelta,
    meanPer100Delta,
    meanDeltaCi,
    pairedT,
    mcNemar: mcnemar,
    classStratified,
  }

  const cloneRate = cloneCounts.successRate
  const additiveRate = additiveCounts.successRate

  // Criterion 1 — primary (spec §6.1).
  const primaryPass = wilcoxon.pValue < 0.05 && meanDelta < 0
  const criterion1: CriterionResult = {
    criterion: 1,
    status: primaryPass ? 'PASS' : 'FAIL',
    detail: primaryPass
      ? `PASS: wilcoxon p = ${wilcoxon.pValue.toFixed(6)} < 0.05 and mean delta = ${meanDelta.toFixed(6)} < 0`
      : `FAIL: wilcoxon p = ${wilcoxon.pValue.toFixed(6)} >= 0.05 or mean delta = ${meanDelta.toFixed(6)} >= 0`,
    values: { wilcoxonP: wilcoxon.pValue, meanDelta, nEffective: wilcoxon.nEffective },
  }

  // Criterion 2 — no task-success regression (spec §6.2).
  const ratesKnown = cloneRate !== null && additiveRate !== null
  const regressionPass = ratesKnown && additiveRate >= cloneRate - 0.05 && mcnemar.exactP >= 0.05
  const criterion2: CriterionResult = {
    criterion: 2,
    status: ratesKnown ? (regressionPass ? 'PASS' : 'FAIL') : 'FAIL',
    detail: ratesKnown
      ? regressionPass
        ? `PASS: additive ${(additiveRate * 100).toFixed(1)}% >= clone ${(cloneRate * 100).toFixed(1)}% - 5pp and mcnemar p = ${mcnemar.exactP.toFixed(6)} >= 0.05`
        : `FAIL: additive ${(additiveRate * 100).toFixed(1)}% < clone ${(cloneRate * 100).toFixed(1)}% - 5pp or mcnemar p = ${mcnemar.exactP.toFixed(6)} < 0.05`
      : 'FAIL: task success rates unavailable (no verifier results)',
    values: { cloneSuccessRate: cloneRate, additiveSuccessRate: additiveRate, mcnemarExactP: mcnemar.exactP },
  }

  // Criterion 3 — quality gate (spec §6.3).
  const qualityPass = ratesKnown && cloneRate >= 0.6 && additiveRate >= 0.6
  const criterion3: CriterionResult = {
    criterion: 3,
    status: ratesKnown ? (qualityPass ? 'PASS' : 'FAIL') : 'FAIL',
    detail: ratesKnown
      ? qualityPass
        ? `PASS: clone ${(cloneRate * 100).toFixed(1)}% >= 60% and additive ${(additiveRate * 100).toFixed(1)}% >= 60%`
        : `FAIL: clone ${(cloneRate * 100).toFixed(1)}% or additive ${(additiveRate * 100).toFixed(1)}% < 60%`
      : 'FAIL: task success rates unavailable (no verifier results)',
    values: { cloneSuccessRate: cloneRate, additiveSuccessRate: additiveRate },
  }

  // Criterion 4 — classifier audit (spec §6.4; value supplied externally).
  const audit = options.auditAgreement
  let criterion4: CriterionResult
  if (audit === undefined) {
    criterion4 = {
      criterion: 4,
      status: 'PENDING',
      detail: 'PENDING: classifier audit agreement not supplied (--audit-agreement)',
      values: { auditAgreement: null },
    }
  } else {
    criterion4 = {
      criterion: 4,
      status: audit >= 0.95 ? 'PASS' : 'FAIL',
      detail: audit >= 0.95
        ? `PASS: audit agreement ${audit.toFixed(6)} >= 0.95`
        : `FAIL: audit agreement ${audit.toFixed(6)} < 0.95`,
      values: { auditAgreement: audit },
    }
  }

  const criteria: [CriterionResult, CriterionResult, CriterionResult, CriterionResult] = [
    criterion1,
    criterion2,
    criterion3,
    criterion4,
  ]
  const overall = criteria.some(criterion => criterion.status === 'FAIL')
    ? 'FAIL'
    : criteria.every(criterion => criterion.status === 'PASS')
      ? 'PASS'
      : 'PENDING'

  const cloneAggregate = armAggregate('clone', cloneCounts, cloneCost)
  const additiveAggregate = armAggregate('additive', additiveCounts, additiveCost)

  // Turn-level aggregate of the primary metric (broaden-design §4.5 n-gain):
  // fold each arm's per-task turn segments into a flat (task, turn) observation
  // set so a multi-turn task yields multiple paired points. Null when neither
  // artifact carries turn data (pre-T6 re-runs / old fixtures).
  const armHasTurns = (sessions: readonly CountsSession[]): boolean =>
    sessions.some(session => session.turns !== undefined && session.turns.length > 0)
  const cloneTurns = armHasTurns(cloneCounts.sessions)
    ? computeTurnAggregate(cloneCounts.sessions.map(session => ({ taskId: session.taskId, turns: session.turns ?? [] })))
    : null
  const additiveTurns = armHasTurns(additiveCounts.sessions)
    ? computeTurnAggregate(additiveCounts.sessions.map(session => ({ taskId: session.taskId, turns: session.turns ?? [] })))
    : null

  return {
    iteration,
    manifestSha256: header?.manifestSha256 ?? null,
    modelPin: header?.pin ?? null,
    fingerprint: header?.fingerprint ?? null,
    auditAgreement: audit ?? null,
    cloneRunAt: typeof cloneCounts.run === 'string' ? cloneCounts.run : null,
    additiveRunAt: typeof additiveCounts.run === 'string' ? additiveCounts.run : null,
    arms: { clone: cloneAggregate, additive: additiveAggregate },
    pairedTasks,
    pairedCount: paired.length,
    unpairedClone,
    unpairedAdditive,
    perClass: { clone: cloneAggregate.totals, additive: additiveAggregate.totals },
    perClassPerSession: { clone: cloneAggregate.perSession, additive: additiveAggregate.perSession },
    cost: {
      clone: costBlock('clone', cloneCost),
      additive: costBlock('additive', additiveCost),
    },
    turnAggregate: { clone: cloneTurns, additive: additiveTurns },
    significance,
    criteria,
    overall,
  }
}

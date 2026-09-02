/**
 * Unit tests for `bench-report` — hypothesis-test statistics (spec §5, §6,
 * §7), the report builder over per-arm artifacts, markdown/JSON rendering,
 * and the report CLI end-to-end.
 *
 * Stats expectations are known values verified against Python reference
 * implementations (scipy). Report fixtures live under
 * `tests/fixtures/report/` in the exact artifact shapes the runner writes
 * (`counts-<arm>.json`, `cost-<arm>.json`, `run.log`).
 *
 * @module @atlasai/atsh-bench/report.spec
 */

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildReport,
  chiSquarePValue,
  computeTurnAggregate,
  computeTurnWasteRatio,
  computeWasteRatio,
  erf,
  loadCostFile,
  loadCountsFile,
  loadRunLogHeader,
  logGamma,
  mcNemar,
  meanConfidenceInterval,
  normalCdf,
  pairedTOneSided,
  parseReportCli,
  regularizedGammaP,
  renderJson,
  renderMarkdown,
  tCdf,
  tQuantile,
  taskClassOf,
  wilcoxonSignedRankOneSided,
} from '../src/index.ts'
import type { BenchReport, CountsArtifact, CountsSession, CostArtifact } from '../src/index.ts'

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/report/', import.meta.url))
const WIN = join(FIXTURE_DIR, 'win')
const LOSE = join(FIXTURE_DIR, 'lose')
const UNPAIRED = join(FIXTURE_DIR, 'unpaired')
const MANIFEST_SHA = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

// ---------------------------------------------------------------------------
// stats.ts — known-value hypothesis tests (verified against scipy)
// ---------------------------------------------------------------------------

describe('bench-report stats — wilcoxon signed-rank (spec §6.1)', () => {
  it('exact: all-positive tie-free n=5 differences -> p = 1/2^5 = 0.03125', () => {
    const result = wilcoxonSignedRankOneSided([6, 5, 4, 3, 2], [1, 1, 1, 1, 1])
    expect(result.statistic).toBe(15) // W+ = 1+2+3+4+5
    expect(result.nEffective).toBe(5)
    expect(result.method).toBe('exact')
    expect(result.tieCorrected).toBe(false)
    expect(result.pValue).toBeCloseTo(1 / 32, 10)
  })

  it('ties: tied |d| forces the normal approximation with the tie correction', () => {
    const clone = [4, 3, 5, 2, 4]
    const additive = [1, 2, 1, 1, 2]
    const first = wilcoxonSignedRankOneSided(clone, additive)
    const second = wilcoxonSignedRankOneSided(clone, additive)
    expect(first).toEqual(second) // deterministic
    expect(first.nEffective).toBe(5)
    expect(first.tieCorrected).toBe(true)
    expect(first.method).toBe('normal-approximation')
    expect(first.statistic).toBe(15) // ranks [4, 1.5, 5, 1.5, 3], all positive
    expect(first.pValue).toBeGreaterThan(0)
    expect(first.pValue).toBeLessThan(0.05)
    expect(first.pValue).toBeCloseTo(0.0289536, 5)
  })

  it('drops zero differences and degrades to p = 1 when every delta is zero', () => {
    const withZero = wilcoxonSignedRankOneSided([5, 3, 4], [1, 3, 1]) // diffs [4, 0, 3]
    expect(withZero.nEffective).toBe(2)
    expect(withZero.statistic).toBe(3)
    expect(withZero.pValue).toBeCloseTo(0.25, 9)
    const degenerate = wilcoxonSignedRankOneSided([2, 2, 2], [2, 2, 2])
    expect(degenerate.method).toBe('degenerate')
    expect(degenerate.nEffective).toBe(0)
    expect(degenerate.pValue).toBe(1)
  })
})

describe('bench-report stats — paired t (spec §5 sensitivity)', () => {
  it('identical positive differences -> t = +Infinity, p = 0, df = n - 1', () => {
    const result = pairedTOneSided([5, 6, 7, 8, 9], [1, 2, 3, 4, 5])
    expect(result.tStatistic).toBe(Number.POSITIVE_INFINITY)
    expect(result.pValue).toBe(0)
    expect(result.df).toBe(4)
  })

  it('mixed differences -> known finite t statistic', () => {
    const result = pairedTOneSided([2, 4, 6, 8], [1, 2, 4, 3]) // diffs [1, 2, 2, 5]
    expect(result.df).toBe(3)
    expect(result.tStatistic).toBeCloseTo(2.886751, 5)
    expect(result.pValue).toBeGreaterThan(0)
    expect(result.pValue).toBeLessThan(0.05)
  })

  it('empty or single-pair input -> p = 1, df = 0', () => {
    expect(pairedTOneSided([], [])).toEqual({ tStatistic: 0, pValue: 1, df: 0 })
    expect(pairedTOneSided([3], [1])).toEqual({ tStatistic: 0, pValue: 1, df: 0 })
  })
})

describe('bench-report stats — mcNemar (spec §6.2)', () => {
  it('known table {a:25, b:2, c:7, d:20} -> continuity-corrected chi-square 16/9, exact p ~ 0.18', () => {
    const rows = [
      ...Array.from({ length: 25 }, () => ({ cloneSuccess: true, additiveSuccess: true })),
      ...Array.from({ length: 2 }, () => ({ cloneSuccess: true, additiveSuccess: false })),
      ...Array.from({ length: 7 }, () => ({ cloneSuccess: false, additiveSuccess: true })),
      ...Array.from({ length: 20 }, () => ({ cloneSuccess: false, additiveSuccess: false })),
    ]
    const result = mcNemar(rows)
    expect(result.b).toBe(2)
    expect(result.c).toBe(7)
    expect(result.chiSquare).toBeCloseTo(16 / 9, 9)
    expect(result.chiSquareP).toBeCloseTo(0.1824224, 6)
    expect(result.exactP).toBeCloseTo(92 / 512, 9)
    expect(result.exactP).toBeGreaterThan(0.05)
  })

  it('10 discordant improvements (b=0, c=10) -> exact p = 2/2^10, small', () => {
    const rows = Array.from({ length: 10 }, () => ({ cloneSuccess: false, additiveSuccess: true }))
    const result = mcNemar(rows)
    expect(result.b).toBe(0)
    expect(result.c).toBe(10)
    expect(result.exactP).toBeCloseTo(2 / 1024, 9)
    expect(result.exactP).toBeLessThan(0.05)
    expect(result.chiSquare).toBeCloseTo(8.1, 9) // (|0-10|-1)^2 / 10
  })

  it('balanced discordants (b=c) cap the two-sided exact p at 1', () => {
    const rows = [
      ...Array.from({ length: 10 }, () => ({ cloneSuccess: true, additiveSuccess: false })),
      ...Array.from({ length: 10 }, () => ({ cloneSuccess: false, additiveSuccess: true })),
    ]
    const result = mcNemar(rows)
    expect(result.exactP).toBe(1) // 2 * P(Bin(10, 0.5) <= 10) capped at 1
  })

  it('no discordant cells -> exact p = 1, chi-square null', () => {
    const result = mcNemar([{ cloneSuccess: true, additiveSuccess: true }])
    expect(result.exactP).toBe(1)
    expect(result.chiSquare).toBeNull()
    expect(result.chiSquareP).toBeNull()
  })
})

describe('bench-report stats — confidence intervals and special functions (spec §7)', () => {
  it('meanConfidenceInterval: mean 3 with a t-based 95% CI on [1..5]', () => {
    const result = meanConfidenceInterval([1, 2, 3, 4, 5])
    expect(result.mean).toBe(3)
    expect(result.ci).not.toBeNull()
    const [lower, upper] = result.ci!
    expect(lower).toBeCloseTo(1.036757, 4)
    expect(upper).toBeCloseTo(4.963243, 4)
    expect(lower).toBeLessThan(3)
    expect(upper).toBeGreaterThan(3)
  })

  it('meanConfidenceInterval: the CI narrows as n grows at the same scale', () => {
    const small = meanConfidenceInterval([1, 2, 3, 4, 5])
    const repeated = meanConfidenceInterval([
      1, 2, 3, 4, 5, 1, 2, 3, 4, 5,
      1, 2, 3, 4, 5, 1, 2, 3, 4, 5,
    ]) // n = 20, same values
    expect(repeated.mean).toBe(3)
    const width = (ci: [number, number] | null): number => (ci === null ? Number.POSITIVE_INFINITY : ci[1] - ci[0])
    expect(width(repeated.ci)).toBeLessThan(width(small.ci))
  })

  it('meanConfidenceInterval: empty and single-value input yield null CIs', () => {
    expect(meanConfidenceInterval([])).toEqual({ mean: 0, ci: null })
    expect(meanConfidenceInterval([7])).toEqual({ mean: 7, ci: null })
  })

  it('special functions hit known reference values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 8) // A&S erf leaves ~1e-9 residue at 0
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2)
    expect(erf(0.35355339)).toBeCloseTo(0.382925, 5)
    expect(tQuantile(0.975, 4)).toBeCloseTo(2.776445, 5)
    expect(tCdf(2.776445, 4)).toBeCloseTo(0.975, 5)
    expect(chiSquarePValue(3.841, 1)).toBeCloseTo(0.05, 2)
    expect(logGamma(5)).toBeCloseTo(3.1780538, 6) // ln(24)
    expect(regularizedGammaP(1, 1)).toBeCloseTo(0.6321206, 6) // 1 - e^-1
  })
})

// ---------------------------------------------------------------------------
// report.ts — buildReport over the on-disk fixtures
// ---------------------------------------------------------------------------

describe('bench-report buildReport — WIN fixture', () => {
  it('clone [4,3,5,2,4] vs additive [1,2,1,1,2]: all four criteria PASS', () => {
    const report = buildReport({
      cloneDir: WIN,
      additiveDir: WIN,
      manifest: join(WIN, 'run.log'),
      auditAgreement: 0.96,
      iteration: 1,
    })
    expect(report.iteration).toBe(1)
    expect(report.manifestSha256).toBe(MANIFEST_SHA)
    expect(report.modelPin).toEqual({ model: 'deepseek-chat', temperature: 0, maxTokens: 8192 })
    expect(report.fingerprint?.nodeVersion).toBe('v22.14.0')
    expect(report.pairedCount).toBe(5)
    expect(report.pairedTasks).toHaveLength(5)
    expect(report.significance.pairedCount).toBe(5)
    expect(report.significance.zeroDropped).toBe(0)
    expect(report.significance.unpairedClone).toBe(0)
    expect(report.significance.unpairedAdditive).toBe(0)
    expect(report.significance.wilcoxon.nEffective).toBe(5)
    expect(report.significance.wilcoxon.statistic).toBe(15)
    expect(report.significance.wilcoxon.pValue).toBeCloseTo(0.0289536, 5)
    expect(report.significance.meanDelta).toBeCloseTo(-2.2, 9) // mean(additive - clone)
    expect(report.significance.meanDeltaCi).not.toBeNull()
    expect(report.significance.meanDeltaCi![0]).toBeLessThan(report.significance.meanDelta)
    expect(report.significance.meanDeltaCi![1]).toBeGreaterThan(report.significance.meanDelta)
    expect(report.significance.pairedT.df).toBe(4)
    expect(report.significance.mcNemar.b).toBe(0) // clone ok / additive fail
    expect(report.significance.mcNemar.c).toBe(1) // clone fail / additive ok
    expect(report.criteria.map(c => c.status)).toEqual(['PASS', 'PASS', 'PASS', 'PASS'])
    expect(report.overall).toBe('PASS')
    expect(report.arms.clone.sessions).toBe(5)
    expect(report.arms.clone.successRate).toBe(0.8)
    expect(report.arms.additive.successRate).toBe(1)
  })
})

describe('bench-report buildReport — LOSE fixture', () => {
  it('additive worse (clone [1,2,1,1,2] vs additive [4,3,5,2,4]): criterion 1 FAIL', () => {
    const report = buildReport({ cloneDir: LOSE, additiveDir: LOSE, auditAgreement: 0.96 })
    expect(report.significance.wilcoxon.statistic).toBe(0) // all differences negative
    expect(report.significance.wilcoxon.pValue).toBeGreaterThan(0.9)
    expect(report.significance.meanDelta).toBeCloseTo(2.2, 9)
    expect(report.criteria[0].status).toBe('FAIL')
    expect(report.criteria.map(c => c.status)).toEqual(['FAIL', 'PASS', 'PASS', 'PASS'])
    expect(report.overall).toBe('FAIL')
  })
})

describe('bench-report buildReport — audit pending (spec §6.4)', () => {
  it('auditAgreement undefined -> criterion 4 PENDING, overall PENDING', () => {
    const report = buildReport({ cloneDir: WIN, additiveDir: WIN })
    expect(report.auditAgreement).toBeNull()
    expect(report.criteria[3].status).toBe('PENDING')
    expect(report.criteria[3].values.auditAgreement).toBeNull()
    expect(report.criteria.map(c => c.status)).toEqual(['PASS', 'PASS', 'PASS', 'PENDING'])
    expect(report.overall).toBe('PENDING')
  })

  it('auditAgreement 0.94 -> criterion 4 FAIL', () => {
    const report = buildReport({ cloneDir: WIN, additiveDir: WIN, auditAgreement: 0.94 })
    expect(report.criteria[3].status).toBe('FAIL')
    expect(report.overall).toBe('FAIL')
  })
})

describe('bench-report buildReport — unpaired tasks', () => {
  it('a clone-only task keeps its row with a blank delta and is excluded from the stats', () => {
    const report = buildReport({ cloneDir: UNPAIRED, additiveDir: UNPAIRED, auditAgreement: 0.96 })
    expect(report.pairedCount).toBe(2)
    expect(report.pairedTasks).toHaveLength(3)
    expect(report.unpairedClone).toEqual(['c'])
    expect(report.unpairedAdditive).toEqual([])
    const rowC = report.pairedTasks.find(row => row.taskId === 'c')!
    expect(rowC.cloneCorrections).toBe(3)
    expect(rowC.additiveCorrections).toBeNull()
    expect(rowC.delta).toBeNull()
    expect(rowC.additivePer100Calls).toBeNull()
    expect(rowC.additiveSuccess).toBeNull()
    // Stats pair only tasks present in BOTH arms: diffs [5, 1] -> exact p = 1/4.
    expect(report.significance.pairedCount).toBe(2)
    expect(report.significance.wilcoxon.nEffective).toBe(2)
    expect(report.significance.wilcoxon.method).toBe('exact')
    expect(report.significance.wilcoxon.pValue).toBeCloseTo(0.25, 9)
    expect(report.significance.meanDelta).toBeCloseTo(-3, 9) // ((1-6) + (2-3)) / 2
    expect(report.significance.mcNemar.exactP).toBe(1) // no discordant pairs
    expect(report.criteria[0].status).toBe('FAIL') // p = 0.25 >= 0.05
  })
})

describe('bench-report buildReport — cost sidecar (spec §7)', () => {
  it('hand-computed means and present 95% CIs for a 2-session arm', () => {
    const report = buildReport({ cloneDir: WIN, additiveDir: WIN, auditAgreement: 0.96 })
    const cloneCost = report.cost.clone
    expect(cloneCost.sessions).toBe(2)
    expect(cloneCost.meanCachedTokens).toBe(2000) // mean(1000, 3000)
    expect(cloneCost.meanUncachedTokens).toBe(3000) // mean(2000, 4000)
    expect(cloneCost.meanCostUsd).toBe(1.0) // mean(0.5, 1.5)
    expect(cloneCost.meanCacheHitRate).toBe(0.5) // mean(0.25, 0.75)
    for (const ci of [cloneCost.cachedTokensCi!, cloneCost.uncachedTokensCi!, cloneCost.costUsdCi!, cloneCost.cacheHitRateCi!]) {
      expect(ci).not.toBeNull()
      expect(ci[0]).toBeLessThanOrEqual(ci[1])
    }
    expect(cloneCost.cachedTokensCi![0]).toBeLessThan(cloneCost.meanCachedTokens)
    expect(cloneCost.cachedTokensCi![1]).toBeGreaterThan(cloneCost.meanCachedTokens)
    const additiveCost = report.cost.additive
    expect(additiveCost.meanCachedTokens).toBe(1000)
    expect(additiveCost.meanUncachedTokens).toBe(2000)
    expect(additiveCost.meanCostUsd).toBe(0.5)
    expect(additiveCost.meanCacheHitRate).toBe(0.7) // mean(0.5, 0.9)
  })
})

describe('bench-report buildReport — per-class counts (spec §2.4)', () => {
  it('per-class sums and per-session means match hand computation', () => {
    const report = buildReport({ cloneDir: WIN, additiveDir: WIN, auditAgreement: 0.96 })
    expect(report.perClass.clone).toEqual({ C1: 6, C2: 3, C3: 2, C4: 2, C5: 5 })
    expect(report.perClass.additive).toEqual({ C1: 1, C2: 1, C3: 1, C4: 1, C5: 3 })
    expect(report.perClassPerSession.clone).toEqual({ C1: 1.2, C2: 0.6, C3: 0.4, C4: 0.4, C5: 1.0 })
    expect(report.perClassPerSession.additive).toEqual({ C1: 0.2, C2: 0.2, C3: 0.2, C4: 0.2, C5: 0.6 })
    // Arm totals (sum over sessions) mirror the per-class sums.
    expect(report.arms.clone.totals).toEqual(report.perClass.clone)
    expect(report.arms.additive.totals).toEqual(report.perClass.additive)
  })
})

describe('bench-report stats — task class resolution (spec §2.4)', () => {
  it('maps taskId prefixes to the memory/debug/coordination/reserve/other classes', () => {
    expect(taskClassOf('mem-1-config-drift')).toBe('memory')
    expect(taskClassOf('mem-06-precedence-trap')).toBe('memory')
    expect(taskClassOf('dbg-01-merge-offbyone')).toBe('debug')
    expect(taskClassOf('coord-1-subtask-handoff')).toBe('coordination')
    expect(taskClassOf('crit-1-plan-follow')).toBe('coordination')
    expect(taskClassOf('rv-01-running-sum')).toBe('reserve')
    expect(taskClassOf('rv-30-zscore-contract')).toBe('reserve')
    expect(taskClassOf('res-1-arxiv-client')).toBe('other')
    expect(taskClassOf('hrd-02-cross-turn-memory')).toBe('other')
    expect(taskClassOf('t1')).toBe('other')
    expect(taskClassOf('')).toBe('other')
  })
})

describe('bench-report buildReport — WIN fixture per-100-call + class-stratified stats', () => {
  it('computes the pooled per-100-call signed-rank alongside the raw test', () => {
    const report = buildReport({ cloneDir: WIN, additiveDir: WIN, auditAgreement: 0.96 })
    const s = report.significance
    // Raw base: clone [4,3,5,2,4] vs additive [1,2,1,1,2]; per-100 base:
    // clone [20,20,20,20,40] vs additive [6.667,10,6.667,6.667,10] — all deltas
    // positive on both bases, so W+ = 15 and the exact one-sided p = 1/2^5.
    expect(s.per100Wilcoxon.nEffective).toBe(5)
    expect(s.per100Wilcoxon.statistic).toBe(15)
    // Ties among the per-100 deltas (6.6667 x3) force the tie-corrected
    // normal approximation, not the exact DP; scipy gives p = 0.03125.
    expect(s.per100Wilcoxon.method).toBe('normal-approximation')
    expect(s.per100Wilcoxon.tieCorrected).toBe(true)
    expect(s.per100Wilcoxon.pValue).toBeLessThan(0.05)
    // mean delta on the per-100 base (additive - clone, so negative here)
    const expectedMean = (6.6667 - 20 + 10 - 20 + 6.6667 - 20 + 6.6667 - 20 + 10 - 40) / 5
    expect(s.meanPer100Delta).toBeCloseTo(expectedMean, 4)
  })

  it('exposes a class-stratified table; WIN tasks are all "other" + carry per-100 values', () => {
    const report = buildReport({ cloneDir: WIN, additiveDir: WIN, auditAgreement: 0.96 })
    expect(report.pairedTasks.every(row => row.taskClass === 'other')).toBe(true)
    expect(report.significance.classStratified).toHaveLength(1)
    const stratum = report.significance.classStratified[0]!
    expect(stratum.taskClass).toBe('other')
    expect(stratum.pairedCount).toBe(5)
    expect(stratum.wilcoxon.statistic).toBe(15)
    // row-level per-100 columns present (spec: report carries per-100-call columns)
    const row = report.pairedTasks[0]!
    expect(row.clonePer100Calls).not.toBeNull()
    expect(row.additivePer100Calls).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// report.ts — loaders and validation
// ---------------------------------------------------------------------------

describe('bench-report loaders', () => {
  it('constructs artifacts in-memory, writes them to a temp dir, and flows them through the loaders', () => {
    const root = mkdtempSync(join(tmpdir(), 'bench-report-tmp-'))
    try {
      const cloneDir = join(root, 'clone')
      const additiveDir = join(root, 'additive')
      mkdirSync(cloneDir)
      mkdirSync(additiveDir)
      const counts = (arm: 'clone' | 'additive', sessions: CountsSession[], meanCorrections: number, successRate: number | null): CountsArtifact => ({
        arm,
        run: '2026-08-16T06:00:00.000Z',
        sessions,
        meanCorrections,
        per100Calls: meanCorrections * 2,
        successRate,
      })
      const session = (taskId: string, total: number, taskSuccess: boolean): CountsSession => ({
        taskId,
        sessionId: `${taskId}-s`,
        exitCode: 0,
        timedOut: false,
        taskSuccess,
        events: 10,
        toolCalls: 5,
        counts: { C1: total, C2: 0, C3: 0, C4: 0, C5: 0 },
        total,
        per100Calls: total * 2,
        hits: [],
      })
      const cost = (arm: 'clone' | 'additive', usd: number[]): CostArtifact => ({
        arm,
        prices: { uncachedInputPerMTok: 0.435, cachedInputPerMTok: 0.0033, outputPerMTok: 1.2 },
        sessions: usd.map((value, index) => ({
          taskId: `t${index + 1}`,
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          uncachedInputTokens: 0,
          outputTokens: 0,
          cacheHitRate: 0.5,
          usd: value,
          usageEvents: 1,
          missingUsageEvents: 0,
        })),
        meanCostUsd: usd.reduce((sum, value) => sum + value, 0) / usd.length,
        meanCacheHitRate: 0.5,
      })
      writeFileSync(join(cloneDir, 'counts-clone.json'), JSON.stringify(counts('clone', [session('t1', 4, true), session('t2', 3, true)], 3.5, 1)))
      writeFileSync(join(additiveDir, 'counts-additive.json'), JSON.stringify(counts('additive', [session('t1', 1, true), session('t2', 2, true)], 1.5, 1)))
      writeFileSync(join(cloneDir, 'cost-clone.json'), JSON.stringify(cost('clone', [0.5, 1.5])))
      writeFileSync(join(additiveDir, 'cost-additive.json'), JSON.stringify(cost('additive', [0.25, 0.75])))

      expect(loadCountsFile(cloneDir, 'clone').sessions).toHaveLength(2)
      expect(loadCostFile(additiveDir, 'additive').meanCostUsd).toBe(0.5)
      const report = buildReport({ cloneDir, additiveDir, auditAgreement: 0.95 })
      expect(report.pairedCount).toBe(2)
      expect(report.significance.meanDelta).toBeCloseTo(-2, 9) // diffs [3, 1]
      expect(report.significance.wilcoxon.pValue).toBeCloseTo(0.25, 9)
      expect(report.arms.clone.sessions).toBe(2)
      expect(report.cost.additive.meanCostUsd).toBe(0.5)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('loaders validate artifacts and report clear errors', () => {
    const bad = mkdtempSync(join(tmpdir(), 'bench-report-bad-'))
    try {
      writeFileSync(join(bad, 'counts-clone.json'), JSON.stringify({ arm: 'clone' }))
      expect(() => loadCountsFile(bad, 'clone')).toThrow(/no sessions array/)
      writeFileSync(join(bad, 'cost-clone.json'), JSON.stringify({ arm: 'clone', sessions: [{ taskId: 1 }] }))
      expect(() => loadCostFile(bad, 'clone')).toThrow(/without taskId\/usd/)
      expect(() => loadCountsFile(bad, 'additive')).toThrow(/cannot read counts artifact/)
    } finally {
      rmSync(bad, { recursive: true, force: true })
    }
  })

  it('buildReport validates iteration and audit agreement', () => {
    expect(() => buildReport({ cloneDir: WIN, additiveDir: WIN, iteration: 0 })).toThrow(/positive integer/)
    expect(() => buildReport({ cloneDir: WIN, additiveDir: WIN, iteration: 1.5 })).toThrow(/positive integer/)
    expect(() => buildReport({ cloneDir: WIN, additiveDir: WIN, auditAgreement: 1.5 })).toThrow(/in \[0, 1\]/)
  })
})

describe('bench-report run log header (spec §9)', () => {
  it('parses the run-start header line: fingerprint, pin, manifest sha256', () => {
    const header = loadRunLogHeader(join(WIN, 'run.log'))
    expect(header.manifestSha256).toBe(MANIFEST_SHA)
    expect(header.pin).toEqual({ model: 'deepseek-chat', temperature: 0, maxTokens: 8192 })
    expect(header.fingerprint?.nodeVersion).toBe('v22.14.0')
    expect(header.fingerprint?.dshProfile).toBe('headless')
  })

  it('accepts a directory path and yields nulls for a missing/unparsable log', () => {
    expect(loadRunLogHeader(WIN).manifestSha256).toBe(MANIFEST_SHA)
    expect(loadRunLogHeader(join(WIN, 'does-not-exist.log'))).toEqual({ fingerprint: null, pin: null, manifestSha256: null })
    const empty = mkdtempSync(join(tmpdir(), 'bench-report-empty-'))
    try {
      writeFileSync(join(empty, 'run.log'), 'not json at all\n')
      expect(loadRunLogHeader(empty)).toEqual({ fingerprint: null, pin: null, manifestSha256: null })
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// markdown.ts + cli.ts — rendering and end-to-end CLI
// ---------------------------------------------------------------------------

describe('bench-report determinism', () => {
  it('identical artifacts produce byte-identical reports and renders', () => {
    const options = { cloneDir: WIN, additiveDir: WIN, manifest: join(WIN, 'run.log'), auditAgreement: 0.96 }
    expect(JSON.stringify(buildReport(options))).toBe(JSON.stringify(buildReport(options)))
    expect(renderMarkdown(buildReport(options))).toBe(renderMarkdown(buildReport(options)))
  })
})

describe('bench-report renderJson', () => {
  it('serializes non-finite numbers as null so the JSON is always well-formed', () => {
    const report = buildReport({ cloneDir: WIN, additiveDir: WIN, auditAgreement: 0.96 })
    const withInf: BenchReport = {
      ...report,
      significance: { ...report.significance, pairedT: { tStatistic: Number.POSITIVE_INFINITY, pValue: 0, df: 4 } },
    }
    const text = renderJson(withInf)
    expect(text.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(text) as { significance: { pairedT: { tStatistic: unknown } } }
    expect(parsed.significance.pairedT.tStatistic).toBeNull()
  })
})

describe('bench-report CLI end-to-end', () => {
  it('writes bench-results.md with every spec §10 block and a parseable JSON sidecar', () => {
    const root = mkdtempSync(join(tmpdir(), 'bench-report-cli-'))
    const out = join(root, 'bench-results.md')
    try {
      const cli = fileURLToPath(new URL('../src/report/cli.ts', import.meta.url))
      const stdout = execFileSync(process.execPath, [
        '--import', 'tsx/esm', cli,
        '--clone-dir', WIN,
        '--additive-dir', WIN,
        '--manifest', join(WIN, 'run.log'),
        '--out', out,
        '--audit-agreement', '0.96',
        '--iteration', '3',
      ], { encoding: 'utf8', cwd: process.cwd() })
      const summary = JSON.parse(stdout) as { iteration: number; overall: string; markdownPath: string; jsonPath: string }
      expect(summary.iteration).toBe(3)
      expect(summary.overall).toBe('PASS')
      const markdown = readFileSync(out, 'utf8')
      for (const heading of [
        '# bench-results.md',
        '## Iteration 3',
        '### Run header',
        '### Paired per-task results',
        '### Per-class counts',
        '### Cost sidecar',
        '### Significance and confidence intervals',
        '### Pass criteria',
      ]) {
        expect(markdown).toContain(heading)
      }
      expect(markdown).toContain('Overall: PASS')
      expect(markdown).toContain(`manifest_sha256: ${MANIFEST_SHA}`)
      const json = JSON.parse(readFileSync(join(root, 'bench-results.json'), 'utf8')) as BenchReport
      expect(json.pairedCount).toBe(5)
      expect(json.iteration).toBe(3)
      expect(json.overall).toBe('PASS')
      expect(json.criteria).toHaveLength(4)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('parseCli rejects out-of-range flags', () => {
    expect(() => parseReportCli(['--audit-agreement', '1.1'])).toThrow(/in \[0, 1\]/)
    expect(() => parseReportCli(['--iteration', '0'])).toThrow(/positive integer/)
    expect(() => parseReportCli(['--bogus'])).toThrow(/unknown flag/)
  })
})

// ---------------------------------------------------------------------------
// computeWasteRatio — the broaden-design primary metric (spec §2)
// ---------------------------------------------------------------------------

/** Build one exported session-log event. */
function ev(type: string, seq: number, data: Record<string, unknown>) {
  return { type, seq, data }
}

/** A `tool/call` event with a JSON-string arguments payload. */
function call(seq: number, name: string, args: Record<string, unknown> = {}) {
  return ev('tool/call', seq, { name, arguments: JSON.stringify(args) })
}

/** A `tool/result` event — the real-harness tool-result-block error shape. */
function result(seq: number, error: boolean = false) {
  return {
    type: 'tool/result',
    seq,
    data: {
      message: {
        content: [error
          ? { type: 'tool-result', isError: true, content: 'boom' }
          : { type: 'tool-result', content: 'ok' }],
      },
    },
  }
}

/** A `tool/result` event with the legacy top-level `error` object shape. */
function resultLegacyError(seq: number) {
  return ev('tool/result', seq, { error: { message: 'boom' } })
}

describe('bench-report computeWasteRatio — primary waste-ratio metric (spec §2)', () => {
  it('all-productive sessions yield wasteRatio 0', () => {
    const events = [
      call(1, 'read'),
      result(2),
      call(3, 'write_file', { path: 'a.txt', content: 'v1' }),
      result(4),
    ]
    const r = computeWasteRatio(events)
    expect(r.totalCalls).toBe(2)
    expect(r.errorCalls).toBe(0)
    expect(r.noopEdits).toBe(0)
    expect(r.postOutcomeCalls).toBe(0)
    expect(r.wastedCalls).toBe(0)
    expect(r.wasteRatio).toBe(0)
  })

  it('counts an erroring call (real harness tool-result shape) as waste', () => {
    const events = [
      call(1, 'write_file', { path: 'a.txt', content: 'v1' }),
      result(2, true),
      call(3, 'write_file', { path: 'a.txt', content: 'v2' }),
      result(4),
    ]
    const r = computeWasteRatio(events)
    expect(r.totalCalls).toBe(2)
    expect(r.errorCalls).toBe(1)
    // Last productive call is call 3 (index 1); nothing after it.
    expect(r.postOutcomeCalls).toBe(0)
    expect(r.wastedCalls).toBe(1)
    expect(r.wasteRatio).toBe(0.5)
  })

  it('recognises the legacy top-level error object shape', () => {
    const events = [
      call(1, 'read'),
      resultLegacyError(2),
    ]
    const r = computeWasteRatio(events)
    expect(r.errorCalls).toBe(1)
    expect(r.wasteRatio).toBe(1)
  })

  it('counts a repeated same-path content edit as a no-op edit', () => {
    const events = [
      call(1, 'write_file', { path: 'a.txt', content: 'same' }),
      result(2),
      call(3, 'write_file', { path: 'a.txt', content: 'same' }),
      result(4),
      call(5, 'write_file', { path: 'a.txt', content: 'new' }),
      result(6),
    ]
    const r = computeWasteRatio(events)
    expect(r.totalCalls).toBe(3)
    expect(r.noopEdits).toBe(1) // the repeated 'same' write at call 2
    expect(r.wastedCalls).toBe(1)
    expect(r.wasteRatio).toBeCloseTo(1 / 3, 10)
  })

  it('counts calls after the last productive call as post-outcome waste', () => {
    const events = [
      call(1, 'write_file', { path: 'a.txt', content: 'v1' }),
      result(2),
      call(3, 'write_file', { path: 'a.txt', content: 'v2' }),
      result(4),
      call(5, 'read'), // after the last productive (state-changing) outcome
      result(6),
    ]
    const r = computeWasteRatio(events)
    expect(r.totalCalls).toBe(3)
    expect(r.errorCalls).toBe(0)
    expect(r.noopEdits).toBe(0)
    expect(r.postOutcomeCalls).toBe(1) // the trailing read
    expect(r.wastedCalls).toBe(1)
    expect(r.wasteRatio).toBeCloseTo(1 / 3, 10)
  })

  it('returns zero waste-ratio on an empty event stream', () => {
    const r = computeWasteRatio([])
    expect(r.totalCalls).toBe(0)
    expect(r.wasteRatio).toBe(0)
    expect(r.wastedCalls).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// computeTurnWasteRatio — per-turn segmentation of the primary metric (§4.5)
// ---------------------------------------------------------------------------

/** A `user/message` event — delimits a turn boundary in multi-turn tasks. */
function userMsg(seq: number, text: string = 'prompt') {
  return ev('user/message', seq, { content: text, role: 'user' })
}

describe('bench-report computeTurnWasteRatio — per-turn segmentation (§4.5)', () => {
  it('reports the session aggregate and splits turns at user/message boundaries', () => {
    // Turn 0 (before first turn delimiter): the opening prompt then work.
    const events = [
      userMsg(1, 'turn 1 prompt'),
      call(2, 'read'),
      result(3),
      call(4, 'write_file', { path: 'a.txt', content: 'v1' }),
      result(5),
      userMsg(6, 'turn 2 prompt'),
      call(7, 'write_file', { path: 'a.txt', content: 'v1' }), // no-op repeat of v1
      result(8),
      call(9, 'write_file', { path: 'a.txt', content: 'v2' }),
      result(10),
    ]
    const r = computeTurnWasteRatio(events)
    // Session: 4 calls total (call2 read, call4 v1, call7 v1-noop, call9 v2),
    // 0 errors + 1 no-op (call 7) + 0 post-outcome.
    expect(r.session.totalCalls).toBe(4)
    expect(r.session.noopEdits).toBe(1)
    expect(r.session.wastedCalls).toBe(1)
    expect(r.turns.length).toBe(2)
    // Turn 0 = [userMsg(1) .. before userMsg(6)): calls 2 and 4, both productive.
    expect(r.turns[0]).toEqual({ turn: 0, totalCalls: 2, wastedCalls: 0, wasteRatio: 0 })
    // Turn 1 = [userMsg(6) .. end): calls 7 (no-op) + 9 (productive) -> 1 wasted / 2.
    expect(r.turns[1]).toEqual({ turn: 1, totalCalls: 2, wastedCalls: 1, wasteRatio: 0.5 })
  })

  it('keeps the session aggregate consistent with the sum of per-turn ids', () => {
    const events = [
      userMsg(1),
      call(2, 'bash'),
      result(3, true),
      userMsg(4),
      call(5, 'read'),
      result(6),
      userMsg(7),
      call(8, 'read'),
      result(9),
    ]
    const r = computeTurnWasteRatio(events)
    const perTurnTotal = r.turns.reduce((sum, t) => sum + t.totalCalls, 0)
    const perTurnWasted = r.turns.reduce((sum, t) => sum + t.wastedCalls, 0)
    expect(r.session.totalCalls).toBe(perTurnTotal) // 3
    expect(r.session.wastedCalls).toBe(perTurnWasted) // 1 (the error in turn 0)
    // Erroring call in turn 0 makes that turn fully wasted.
    expect(r.turns[0]!.wasteRatio).toBe(1)
    expect(r.turns[1]!.wasteRatio).toBe(0)
    expect(r.turns[2]!.wasteRatio).toBe(0)
  })

  it('returns an empty turn list and zero session waste for an eventless stream', () => {
    const r = computeTurnWasteRatio([])
    expect(r.session.wasteRatio).toBe(0)
    expect(r.turns.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// computeTurnAggregate — the turn-level n-gain aggregate of the primary metric
// (§4.5): a multi-turn task contributes one observation per running turn.
// ---------------------------------------------------------------------------

describe('bench-report computeTurnAggregate — turn-level aggregate (§4.5 n-gain)', () => {
  it('folds multi-turn sessions into one observation per running turn', () => {
    const sessions = [
      {
        taskId: 'web-a',
        turns: [
          { turn: 0, totalCalls: 2, wastedCalls: 1, wasteRatio: 0.5 },
          { turn: 1, totalCalls: 3, wastedCalls: 0, wasteRatio: 0 },
          { turn: 2, totalCalls: 4, wastedCalls: 2, wasteRatio: 0.5 },
        ],
      },
      {
        taskId: 'fin-b',
        turns: [
          { turn: 0, totalCalls: 1, wastedCalls: 1, wasteRatio: 1 },
        ],
      },
    ]
    const agg = computeTurnAggregate(sessions)
    expect(agg.observationCount).toBe(4) // 3 turns + 1 turn
    expect(agg.multiTurnTaskCount).toBe(1) // fin-b has 1 turn, web-a has 3
    expect(agg.observations.map(o => o.taskId)).toEqual(['fin-b', 'web-a', 'web-a', 'web-a'])
    expect(agg.observations.map(o => o.turn)).toEqual([0, 0, 1, 2])
    // mean = (1 + 0.5 + 0 + 0.5) / 4
    expect(agg.meanWasteRatio).toBeCloseTo(0.5, 9)
  })

  it('skips turns that ran no call (empty turns and zero-call segments)', () => {
    const sessions = [
      { taskId: 't1', turns: [] },
      { taskId: 't2', turns: [{ turn: 0, totalCalls: 0, wastedCalls: 0, wasteRatio: 0 }] },
      { taskId: 't3', turns: [{ turn: 0, totalCalls: 5, wastedCalls: 5, wasteRatio: 1 }] },
    ]
    const agg = computeTurnAggregate(sessions)
    expect(agg.observationCount).toBe(1)
    expect(agg.multiTurnTaskCount).toBe(0)
    expect(agg.observations[0]).toEqual({ taskId: 't3', turn: 0, totalCalls: 5, wastedCalls: 5, wasteRatio: 1 })
    expect(agg.meanWasteRatio).toBe(1)
  })

  it('returns empty observations + zero mean for no turn data', () => {
    const agg = computeTurnAggregate([])
    expect(agg.observationCount).toBe(0)
    expect(agg.multiTurnTaskCount).toBe(0)
    expect(agg.meanWasteRatio).toBe(0)
    expect(agg.observations).toEqual([])
  })

  it('buildReport surfaces the per-arm turn aggregate when artifacts carry turns', () => {
    const root = mkdtempSync(join(tmpdir(), 'bench-rep-turn-'))
    const cloneDir = join(root, 'clone')
    const additiveDir = join(root, 'additive')
    mkdirSync(cloneDir, { recursive: true })
    mkdirSync(additiveDir, { recursive: true })
    const counts = (arm: 'clone' | 'additive'): CountsArtifact => ({
      arm,
      run: '2026-08-24T00:00:00.000Z',
      meanCorrections: 0,
      per100Calls: 0,
      successRate: 1,
      sessions: [
        {
          taskId: 'web-a',
          exitCode: 0,
          timedOut: false,
          taskSuccess: true,
          events: 20,
          toolCalls: 5,
          counts: { C1: 1, C2: 0, C3: 0, C4: 0, C5: 0 },
          total: 1,
          per100Calls: 20,
          hits: [],
          turns: [
            { turn: 0, totalCalls: 2, wastedCalls: 1, wasteRatio: 0.5 },
            { turn: 1, totalCalls: 3, wastedCalls: 0, wasteRatio: 0 },
          ],
        },
        {
          taskId: 'fin-b',
          exitCode: 0,
          timedOut: false,
          taskSuccess: true,
          events: 1,
          toolCalls: 2,
          counts: { C1: 0, C2: 1, C3: 0, C4: 0, C5: 0 },
          total: 1,
          per100Calls: 50,
          hits: [],
          turns: [{ turn: 0, totalCalls: 2, wastedCalls: 2, wasteRatio: 1 }],
        },
      ],
    })
    const cost = (arm: 'clone' | 'additive'): CostArtifact => ({
      arm,
      prices: { uncachedInputPerMTok: 1, cachedInputPerMTok: 0.1, outputPerMTok: 2 },
      sessions: [
        { taskId: 'web-a', inputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0, uncachedInputTokens: 100, outputTokens: 10, cacheHitRate: 0, usd: 0.001, usageEvents: 1, missingUsageEvents: 0 },
        { taskId: 'fin-b', inputTokens: 50, cachedInputTokens: 0, cacheWriteTokens: 0, uncachedInputTokens: 50, outputTokens: 5, cacheHitRate: 0, usd: 0.0005, usageEvents: 1, missingUsageEvents: 0 },
      ],
      meanCostUsd: 0.00075,
      meanCacheHitRate: 0,
    })
    writeFileSync(join(cloneDir, 'counts-clone.json'), `${JSON.stringify(counts('clone'))}\n`)
    writeFileSync(join(additiveDir, 'counts-additive.json'), `${JSON.stringify(counts('additive'))}\n`)
    writeFileSync(join(cloneDir, 'cost-clone.json'), `${JSON.stringify(cost('clone'))}\n`)
    writeFileSync(join(additiveDir, 'cost-additive.json'), `${JSON.stringify(cost('additive'))}\n`)
    const report = buildReport({ cloneDir, additiveDir })
    expect(report.turnAggregate.clone).not.toBeNull()
    expect(report.turnAggregate.additive).not.toBeNull()
    expect(report.turnAggregate.clone!.observationCount).toBe(3) // web-a(2) + fin-b(1)
    expect(report.turnAggregate.additive!.observationCount).toBe(3)
    expect(report.turnAggregate.clone!.observations.map(o => o.taskId)).toEqual(['fin-b', 'web-a', 'web-a'])
    // Old fixtures (no turns) yield a null aggregate — backward compatible.
    const legacyReport = buildReport({ cloneDir: WIN, additiveDir: WIN })
    expect(legacyReport.turnAggregate.clone).toBeNull()
    expect(legacyReport.turnAggregate.additive).toBeNull()
    rmSync(root, { recursive: true, force: true })
  })
})

/**
 * `bench-report` markdown rendering — emit bench-results.md with EVERY spec
 * §10 block (per-iteration header, paired per-task table, per-class counts,
 * cost sidecar with 95% CIs, significance + CI, pass/fail per criterion).
 *
 * Numbers are actual values, never adjectives (CSG-SME1000 Anchor Rule):
 * every figure in the document is a measured number or a CI, formatted
 * deterministically (`toFixed`). Rendering is a pure function of the report
 * — two renders of the same report are byte-identical.
 *
 * @module @atlasai/atsh-bench/report/markdown
 */

import type { BenchReport, PairedTaskRow } from './types.ts'

/** Format a finite number to a fixed digit count; null/non-finite render as '—'. */
function fmt(n: number | null | undefined, digits = 6): string {
  if (n === null || n === undefined) return '—'
  if (!Number.isFinite(n)) return n > 0 ? 'inf' : '-inf'
  return n.toFixed(digits)
}

/** Format an integer (corrections per task); null renders as '—'. */
function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return String(Math.round(n))
}

/** Format a p-value; tiny p-values render as a '<' bound, never '0.000000'. */
function fmtP(p: number): string {
  if (p < 1e-6) return '<0.000001'
  return p.toFixed(6)
}

/** Format a success boolean; null renders as '—'. */
function fmtBool(value: boolean | null): string {
  return value === null ? '—' : value ? 'yes' : 'no'
}

/** Format a rate as a percentage; null renders as '—'. */
function fmtPct(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`
}

/** One row of the paired per-task table (spec §10). */
function pairedRow(row: PairedTaskRow): string {
  return [
    `| ${row.taskId}`,
    ` ${row.taskClass}`,
    ` ${fmtInt(row.cloneCorrections)}`,
    ` ${fmtInt(row.additiveCorrections)}`,
    ` ${row.delta === null ? '—' : fmtInt(row.delta)}`,
    ` ${row.clonePer100Calls === null ? '—' : fmt(row.clonePer100Calls)}`,
    ` ${row.additivePer100Calls === null ? '—' : fmt(row.additivePer100Calls)}`,
    ` ${row.cloneSuccess === null ? '—' : fmtBool(row.cloneSuccess)}`,
    ` ${row.additiveSuccess === null ? '—' : fmtBool(row.additiveSuccess)} |`,
  ].join('')
}

/** Per-class counts spec block (spec §2.4 secondary metric). */
function perClassBlock(report: BenchReport): string {
  return JSON.stringify({
    clone: {
      sum: report.perClass.clone,
      meanPerSession: report.perClassPerSession.clone,
    },
    additive: {
      sum: report.perClass.additive,
      meanPerSession: report.perClassPerSession.additive,
    },
  }, null, 2)
}

/** Cost sidecar spec block per arm (spec §7) — means with 95% CIs. */
interface CostArmBlock {
  arm: string
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

function costArmBlock(block: CostArmBlock): Record<string, unknown> {
  return {
    arm: block.arm,
    sessions: block.sessions,
    meanCachedTokensPerSession: { mean: block.meanCachedTokens, ci95: block.cachedTokensCi },
    meanUncachedTokensPerSession: { mean: block.meanUncachedTokens, ci95: block.uncachedTokensCi },
    meanCostUsdPerSession: { mean: block.meanCostUsd, ci95: block.costUsdCi },
    meanCacheHitRate: { mean: block.meanCacheHitRate, ci95: block.cacheHitRateCi },
  }
}

/** Significance + CI spec block (spec §6.1, §5 sensitivity check). */
function significanceBlock(report: BenchReport): string {
  const s = report.significance
  return JSON.stringify({
    pairedCount: s.pairedCount,
    zeroDropped: s.zeroDropped,
    unpairedClone: s.unpairedClone,
    unpairedAdditive: s.unpairedAdditive,
    wilcoxon: {
      statistic: s.wilcoxon.statistic,
      pValue: s.wilcoxon.pValue,
      nEffective: s.wilcoxon.nEffective,
      method: s.wilcoxon.method,
      tieCorrected: s.wilcoxon.tieCorrected,
    },
    per100Wilcoxon: {
      statistic: s.per100Wilcoxon.statistic,
      pValue: s.per100Wilcoxon.pValue,
      nEffective: s.per100Wilcoxon.nEffective,
      method: s.per100Wilcoxon.method,
      tieCorrected: s.per100Wilcoxon.tieCorrected,
    },
    meanDelta: { mean: s.meanDelta, ci95: s.meanDeltaCi },
    meanPer100Delta: s.meanPer100Delta,
    pairedT: {
      tStatistic: s.pairedT.tStatistic,
      pValue: s.pairedT.pValue,
      df: s.pairedT.df,
    },
    mcNemar: {
      b: s.mcNemar.b,
      c: s.mcNemar.c,
      exactP: s.mcNemar.exactP,
      chiSquare: s.mcNemar.chiSquare,
      chiSquareP: s.mcNemar.chiSquareP,
    },
    classStratified: s.classStratified.map(stratum => ({
      taskClass: stratum.taskClass,
      pairedCount: stratum.pairedCount,
      zeroDropped: stratum.zeroDropped,
      meanPer100Delta: stratum.meanPer100Delta,
      wilcoxon: {
        statistic: stratum.wilcoxon.statistic,
        pValue: stratum.wilcoxon.pValue,
        nEffective: stratum.wilcoxon.nEffective,
        method: stratum.wilcoxon.method,
        tieCorrected: stratum.wilcoxon.tieCorrected,
      },
    })),
  }, null, 2)
}

/**
 * Render the full bench-results.md document for one iteration (spec §10).
 * @param report - the report to render.
 * @returns the markdown text (deterministic for the same report).
 */
export function renderMarkdown(report: BenchReport): string {
  const lines: string[] = []
  lines.push('# bench-results.md', '')
  lines.push(`## Iteration ${report.iteration}`, '')
  lines.push('### Run header', '')
  lines.push(`- iteration: ${report.iteration}`)
  lines.push(`- manifest_sha256: ${report.manifestSha256 ?? '—'}`)
  lines.push(`- model pin: ${report.modelPin === null ? '—' : `${report.modelPin.model} (temperature ${report.modelPin.temperature}, maxTokens ${report.modelPin.maxTokens})`}`)
  lines.push(`- clone arm run at: ${report.cloneRunAt ?? '—'}`)
  lines.push(`- additive arm run at: ${report.additiveRunAt ?? '—'}`)
  lines.push('')
  lines.push('```json')
  lines.push(report.fingerprint === null ? 'not supplied' : JSON.stringify(report.fingerprint, null, 2))
  lines.push('```')
  lines.push('')
  lines.push('### Paired per-task results', '')
  lines.push('| task | class | clone corrections | additive corrections | delta (additive - clone) | clone per-100 calls | additive per-100 calls | clone success | additive success |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const row of report.pairedTasks) lines.push(pairedRow(row))
  lines.push('')
  lines.push(`Paired tasks: ${report.pairedCount}. Zero-delta tasks (excluded from the signed-rank test): ${report.significance.zeroDropped}.`)
  lines.push(`Clone-only tasks: ${report.unpairedClone.length > 0 ? report.unpairedClone.join(', ') : 'none'}.`)
  lines.push(`Additive-only tasks: ${report.unpairedAdditive.length > 0 ? report.unpairedAdditive.join(', ') : 'none'}.`)
  lines.push('')
  lines.push('### Per-class counts', '')
  lines.push('```json')
  lines.push(perClassBlock(report))
  lines.push('```')
  lines.push('')
  lines.push('### Cost sidecar', '')
  lines.push('```json')
  lines.push(JSON.stringify({
    clone: costArmBlock(report.cost.clone),
    additive: costArmBlock(report.cost.additive),
  }, null, 2))
  lines.push('```')
  lines.push('')
  lines.push(`Clone arm: ${report.arms.clone.sessions} sessions, mean corrections ${fmt(report.arms.clone.meanCorrections)}, corrections per 100 calls ${fmt(report.arms.clone.per100Calls)}, success ${fmtPct(report.arms.clone.successRate)}.`)
  lines.push(`Additive arm: ${report.arms.additive.sessions} sessions, mean corrections ${fmt(report.arms.additive.meanCorrections)}, corrections per 100 calls ${fmt(report.arms.additive.per100Calls)}, success ${fmtPct(report.arms.additive.successRate)}.`)
  lines.push('')
  lines.push('### Significance and confidence intervals', '')
  lines.push('```json')
  lines.push(significanceBlock(report))
  lines.push('```')
  lines.push('')
  const s = report.significance
  lines.push(`Mean delta: ${fmt(s.meanDelta)} (95% CI ${s.meanDeltaCi === null ? '—' : `[${fmt(s.meanDeltaCi[0])}, ${fmt(s.meanDeltaCi[1])}]`}).`)
  lines.push(`Wilcoxon signed-rank: one-sided p = ${fmtP(s.wilcoxon.pValue)} (${s.wilcoxon.method}, n_effective ${s.wilcoxon.nEffective}, W+ = ${s.wilcoxon.statistic}).`)
  lines.push(`Wilcoxon signed-rank (per-100-call base): one-sided p = ${fmtP(s.per100Wilcoxon.pValue)} (${s.per100Wilcoxon.method}, n_effective ${s.per100Wilcoxon.nEffective}, W+ = ${s.per100Wilcoxon.statistic}); mean per-100-call delta = ${fmt(s.meanPer100Delta)}.`)
  lines.push(`Paired t sensitivity: t = ${fmt(s.pairedT.tStatistic)} (df ${s.pairedT.df}, one-sided p = ${fmtP(s.pairedT.pValue)}).`)
  lines.push(`McNemar: b = ${s.mcNemar.b}, c = ${s.mcNemar.c}, exact p = ${fmtP(s.mcNemar.exactP)}${s.mcNemar.chiSquare === null ? '' : `, continuity-corrected chi-square = ${fmt(s.mcNemar.chiSquare)} (p = ${fmtP(s.mcNemar.chiSquareP ?? 1)})`}.`)
  lines.push('')
  lines.push('### Class-stratified signed-rank (per-100-call base)', '')
  lines.push('| class | paired | zero-dropped | mean per-100 delta | wilcoxon p | method | W+ |')
  lines.push('|---|---|---|---|---|---|---|')
  if (s.classStratified.length === 0) {
    lines.push('| — | 0 | 0 | — | — | — | — |')
  } else {
    for (const stratum of s.classStratified) {
      lines.push(`| ${stratum.taskClass} | ${stratum.pairedCount} | ${stratum.zeroDropped} | ${fmt(stratum.meanPer100Delta)} | ${fmtP(stratum.wilcoxon.pValue)} | ${stratum.wilcoxon.method} | ${fmt(stratum.wilcoxon.statistic)} |`)
    }
  }
  lines.push('')
  lines.push('### Per-turn aggregate of the primary metric (waste-ratio)', '')
  const ta = report.turnAggregate
  const turnArm = (arm: 'clone' | 'additive', label: string): string => {
    const agg = arm === 'clone' ? ta.clone : ta.additive
    if (agg === null) return `${label}: no per-turn data in artifact (pre-T6 re-run).`
    const taskCount = new Set(agg.observations.map(o => o.taskId)).size
    return `${label}: ${agg.observationCount} turn-level observations across ${taskCount} tasks; multi-turn tasks = ${agg.multiTurnTaskCount}; mean per-turn waste-ratio = ${fmt(agg.meanWasteRatio)}.`
  }
  lines.push(turnArm('clone', 'Clone'))
  lines.push(turnArm('additive', 'Additive'))
  for (const arm of ['clone', 'additive'] as const) {
    const agg = arm === 'clone' ? ta.clone : ta.additive
    if (agg === null || agg.observations.length === 0) continue
    lines.push('')
    lines.push(`${arm === 'clone' ? 'Clone' : 'Additive'} per-turn observations`, '')
    lines.push('| task | turn | total calls | wasted calls | waste ratio |')
    lines.push('|---|---|---|---|---|')
    for (const o of agg.observations) {
      lines.push(`| ${o.taskId} | ${o.turn} | ${o.totalCalls} | ${o.wastedCalls} | ${fmt(o.wasteRatio)} |`)
    }
  }
  lines.push('')
  lines.push('### Pass criteria', '')
  lines.push('| criterion | status | detail |')
  lines.push('|---|---|---|')
  lines.push(`| 1. primary (wilcoxon p < 0.05, mean delta < 0) | ${report.criteria[0].status} | ${report.criteria[0].detail} |`)
  lines.push(`| 2. no task-success regression | ${report.criteria[1].status} | ${report.criteria[1].detail} |`)
  lines.push(`| 3. quality gate (both arms >= 60% success) | ${report.criteria[2].status} | ${report.criteria[2].detail} |`)
  lines.push(`| 4. classifier audit >= 95% agreement | ${report.criteria[3].status} | ${report.criteria[3].detail} |`)
  lines.push('')
  lines.push(`Overall: ${report.overall}`, '')
  return lines.join('\n')
}

/**
 * Serialize the report as the sidecar bench-results.json. Non-finite
 * numbers (only possible in the paired-t sensitivity statistic's degenerate
 * all-identical-differences case) serialize as null so the JSON is always
 * well-formed.
 * @param report - the report to serialize.
 * @returns the JSON text (deterministic, trailing newline).
 */
export function renderJson(report: BenchReport): string {
  return `${JSON.stringify(report, (_key: string, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) return null
    return value
  }, 2)}\n`
}

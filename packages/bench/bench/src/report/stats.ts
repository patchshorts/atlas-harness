/**
 * `bench-report` statistics — pure-TypeScript, dependency-free, deterministic
 * hypothesis tests and intervals (benchmark spec §5, §6, §7).
 *
 * Everything here is a pure function of its inputs: no `Math.random`, no
 * clock, no I/O. Implemented from scratch (verified: the monorepo carries no
 * statistics library) —
 *
 * - one-sided Wilcoxon signed-rank test (primary, spec §6.1): exact
 *   distribution via DP over the rank-sum distribution when the effective
 *   sample is small (n <= 30) and tie-free; otherwise the normal
 *   approximation with the standard tie correction and a continuity
 *   correction;
 * - one-sided paired t-test (sensitivity check, spec §5);
 * - McNemar's test on the paired success table (spec §6.2): exact binomial
 *   two-sided p on the discordant cells, plus the continuity-corrected
 *   chi-square as a sensitivity check;
 * - 95% confidence interval for a mean via the t distribution
 *   (mean +/- t_{0.975,n-1} * SE), with the normal CDF (erf) and the t
 *   quantile (bisection on the regularized incomplete beta) implemented in
 *   pure TS.
 *
 * Sign convention: the signed-rank and paired-t tests receive the two arms
 * as `(clone, additive)` and test the one-sided alternative "additive
 * corrections < clone corrections" — i.e. positive `clone - additive`
 * differences. This matches spec §6.1's pass condition (additive strictly
 * below clone) while the report's per-task delta (additive - clone) stays
 * negative in the same situation.
 *
 * @module @atlasai/atsh-bench/report/stats
 */

import { canonicalJson, sha256Hex } from '../classify/events.ts'
import type { SessionLogEvent } from '../classify/types.ts'
import type { McNemarResult, PairedTResult, WilcoxonResult } from './types.ts'

/** Lanczos coefficients (g = 7, n = 9) — standard deterministic log-gamma. */
const LANCZOS_C: readonly number[] = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
]

/**
 * Natural logarithm of the gamma function (Lanczos approximation).
 * @param z - argument (positive; reflection used below 0.5).
 * @returns ln(Gamma(z)).
 */
export function logGamma(z: number): number {
  if (z < 0.5) {
    // Reflection formula: Gamma(z) Gamma(1-z) = pi / sin(pi z).
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z)
  }
  const zz = z - 1
  let x = LANCZOS_C[0] ?? 0
  for (let i = 1; i < LANCZOS_C.length; i += 1) {
    x += (LANCZOS_C[i] ?? 0) / (zz + i)
  }
  const t = zz + 7 + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x)
}

/**
 * Error function (Abramowitz & Stegun 7.1.26; |error| <= 1.5e-7).
 * @param x - argument.
 * @returns erf(x).
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  return sign * (1 - poly * Math.exp(-ax * ax))
}

/**
 * Standard normal CDF.
 * @param z - z-score.
 * @returns Phi(z).
 */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

/**
 * Lower regularized incomplete gamma P(a, x) via the series expansion
 * (valid for x < a + 1; use {@link regularizedGammaQ} for larger x).
 * @param a - shape parameter.
 * @param x - argument.
 * @returns P(a, x) = gamma(a, x) / Gamma(a).
 */
export function regularizedGammaP(a: number, x: number): number {
  if (x <= 0) return 0
  let sum = 1 / a
  let term = sum
  let ap = a
  for (let i = 0; i < 300; i += 1) {
    ap += 1
    term *= x / ap
    sum += term
    if (Math.abs(term) < Math.abs(sum) * 3e-14) break
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a))
}

/**
 * Upper regularized incomplete gamma Q(a, x) via the continued fraction
 * (Lentz), with the series fallback for small x.
 * @param a - shape parameter.
 * @param x - argument.
 * @returns Q(a, x) = 1 - P(a, x).
 */
export function regularizedGammaQ(a: number, x: number): number {
  if (x <= 0) return 1
  if (x < a + 1) return 1 - regularizedGammaP(a, x)
  const fpm = 1e-300
  let b = x + 1 - a
  let c = 1 / fpm
  let d = 1 / b
  let h = d
  for (let i = 1; i <= 300; i += 1) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < fpm) d = fpm
    c = b + an / c
    if (Math.abs(c) < fpm) c = fpm
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 3e-14) break
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h
}

/**
 * Chi-square survival probability P(X > x) for X ~ chi2(df).
 * @param x - observed statistic (>= 0).
 * @param df - degrees of freedom.
 * @returns the upper-tail p-value.
 */
export function chiSquarePValue(x: number, df: number): number {
  if (x <= 0) return 1
  if (!Number.isFinite(x)) return 0
  return regularizedGammaQ(df / 2, x / 2)
}

/** Continued fraction for the regularized incomplete beta (Lentz). */
function betacf(x: number, a: number, b: number): number {
  const fpm = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - qab * x / qap
  if (Math.abs(d) < fpm) d = fpm
  d = 1 / d
  let h = d
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < fpm) d = fpm
    c = 1 + aa / c
    if (Math.abs(c) < fpm) c = fpm
    d = 1 / d
    h *= d * c
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < fpm) d = fpm
    c = 1 + aa / c
    if (Math.abs(c) < fpm) c = fpm
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 3e-14) break
  }
  return h
}

/**
 * Regularized incomplete beta I_x(a, b).
 * @param x - argument in [0, 1].
 * @param a - first shape parameter.
 * @param b - second shape parameter.
 * @returns I_x(a, b).
 */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b)
    + a * Math.log(x) + b * Math.log1p(-x),
  )
  // Use whichever continued fraction converges faster (NR betai split).
  if (x < (a + 1) / (a + b + 2)) {
    return bt * betacf(x, a, b) / a
  }
  return 1 - bt * betacf(1 - x, b, a) / b
}

/**
 * Student's t CDF. For t >= 0: F(t) = 1 - 0.5 * I_{df/(df+t^2)}(df/2, 1/2).
 * @param t - statistic.
 * @param df - degrees of freedom (>= 1).
 * @returns P(T <= t).
 */
export function tCdf(t: number, df: number): number {
  if (t === 0) return 0.5
  if (t > 0) {
    const x = df / (df + t * t)
    return 1 - 0.5 * regularizedIncompleteBeta(x, df / 2, 0.5)
  }
  return 1 - tCdf(-t, df)
}

/**
 * Student's t quantile via bisection on {@link tCdf}.
 * @param p - probability in (0, 1).
 * @param df - degrees of freedom (>= 1).
 * @returns t such that P(T <= t) = p.
 */
export function tQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new Error(`bench-report: t quantile probability must be in (0, 1), got ${p}`)
  if (df < 1) throw new Error(`bench-report: t quantile needs df >= 1, got ${df}`)
  if (p === 0.5) return 0
  if (p < 0.5) return -tQuantile(1 - p, df)
  let upper = 1
  while (tCdf(upper, df) < p) upper *= 2
  let lower = 0
  for (let i = 0; i < 80; i += 1) {
    const mid = (lower + upper) / 2
    if (tCdf(mid, df) < p) lower = mid
    else upper = mid
  }
  return (lower + upper) / 2
}

/**
 * One-sided Wilcoxon signed-rank test (H1: additive corrections < clone
 * corrections). Differences are `clone - additive` per paired index; zero
 * differences are dropped; absolute differences are ranked with average
 * ranks for ties. The p-value is exact (DP over the rank-sum distribution)
 * when the effective sample has no ties and n <= 30, else the normal
 * approximation with the tie correction and a continuity correction.
 *
 * @param clone - clone-arm corrections per paired task.
 * @param additive - additive-arm corrections per paired task (same order).
 * @returns the Wilcoxon result.
 */
export function wilcoxonSignedRankOneSided(clone: readonly number[], additive: readonly number[]): WilcoxonResult {
  const diffs: number[] = []
  const n = Math.min(clone.length, additive.length)
  for (let i = 0; i < n; i += 1) {
    const d = (clone[i] ?? 0) - (additive[i] ?? 0)
    if (d !== 0) diffs.push(d)
  }
  const effective = diffs.length
  if (effective === 0) {
    return { statistic: 0, pValue: 1, nEffective: 0, method: 'degenerate', tieCorrected: false }
  }
  // Average ranks for |d| (ties share the mean of their rank span).
  const abs = diffs.map(d => Math.abs(d)).sort((a, b) => a - b)
  const ranks: number[] = new Array<number>(effective)
  let index = 0
  let tieCorrected = false
  while (index < effective) {
    let end = index + 1
    while (end < effective && abs[end] === abs[index]) end += 1
    const groupSize = end - index
    if (groupSize > 1) tieCorrected = true
    const meanRank = (index + 1 + end) / 2
    for (let j = index; j < end; j += 1) ranks[j] = meanRank
    index = end
  }
  let statistic = 0
  for (let i = 0; i < effective; i += 1) {
    if ((diffs[i] ?? 0) > 0) statistic += ranks[i] ?? 0
  }
  if (effective <= 30 && !tieCorrected) {
    // Exact: count subsets of {1..n} whose rank sum is >= statistic.
    const maxSum = effective * (effective + 1) / 2
    const dp = new Array<number>(maxSum + 1).fill(0)
    dp[0] = 1
    for (let r = 1; r <= effective; r += 1) {
      for (let s = maxSum; s >= r; s -= 1) {
        dp[s] = (dp[s] ?? 0) + (dp[s - r] ?? 0)
      }
    }
    let favorable = 0
    for (let s = statistic; s <= maxSum; s += 1) favorable += dp[s] ?? 0
    const pValue = favorable / 2 ** effective
    return { statistic, pValue, nEffective: effective, method: 'exact', tieCorrected: false }
  }
  // Normal approximation with tie correction + continuity correction.
  const mu = effective * (effective + 1) / 4
  let tieCorrection = 0
  let groupIndex = 0
  while (groupIndex < effective) {
    let end = groupIndex + 1
    while (end < effective && abs[end] === abs[groupIndex]) end += 1
    const t = end - groupIndex
    if (t > 1) tieCorrection += (t ** 3 - t) / 48
    groupIndex = end
  }
  const variance = effective * (effective + 1) * (2 * effective + 1) / 24 - tieCorrection
  const sd = Math.sqrt(variance)
  const z = (statistic - mu - 0.5) / sd
  const pValue = 1 - normalCdf(z)
  return { statistic, pValue, nEffective: effective, method: 'normal-approximation', tieCorrected }
}

/**
 * One-sided paired t-test (H1: additive corrections < clone corrections).
 * Differences are `clone - additive`; the statistic is mean(d) / SE(d).
 *
 * @param clone - clone-arm values per paired task.
 * @param additive - additive-arm values per paired task (same order).
 * @returns the t-test result.
 */
export function pairedTOneSided(clone: readonly number[], additive: readonly number[]): PairedTResult {
  const n = Math.min(clone.length, additive.length)
  if (n === 0) return { tStatistic: 0, pValue: 1, df: 0 }
  if (n < 2) return { tStatistic: 0, pValue: 1, df: 0 }
  const diffs: number[] = []
  for (let i = 0; i < n; i += 1) diffs.push((clone[i] ?? 0) - (additive[i] ?? 0))
  const mean = diffs.reduce((sum, d) => sum + d, 0) / n
  const variance = diffs.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (n - 1)
  const se = Math.sqrt(variance) / Math.sqrt(n)
  if (se === 0) {
    // All differences identical: the statistic is unbounded in the sign's direction.
    return {
      tStatistic: mean > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
      pValue: mean > 0 ? 0 : 1,
      df: n - 1,
    }
  }
  const tStatistic = mean / se
  const pValue = tStatistic === Number.POSITIVE_INFINITY ? 0
    : tStatistic === Number.NEGATIVE_INFINITY ? 1
      : 1 - tCdf(tStatistic, n - 1)
  return { tStatistic, pValue, df: n - 1 }
}

/** Binomial coefficient C(n, k) — deterministic, small-n only. */
function binomial(n: number, k: number): number {
  let result = 1
  for (let i = 0; i < k; i += 1) {
    result = result * (n - i) / (i + 1)
  }
  return result
}

/**
 * McNemar's test on the paired success table (spec §6.2). Cells: `b` = clone
 * success / additive failure (regression), `c` = clone failure / additive
 * success (improvement). The exact two-sided p is the binomial probability
 * of the discordant split (2 * P(Bin(b+c, 0.5) <= min(b, c)), capped at 1);
 * the continuity-corrected chi-square is reported as a sensitivity check.
 *
 * @param rows - paired per-task success outcomes.
 * @returns the McNemar result.
 */
export function mcNemar(rows: ReadonlyArray<{ cloneSuccess: boolean; additiveSuccess: boolean }>): McNemarResult {
  let b = 0
  let c = 0
  for (const row of rows) {
    if (row.cloneSuccess && !row.additiveSuccess) b += 1
    if (!row.cloneSuccess && row.additiveSuccess) c += 1
  }
  const discordant = b + c
  if (discordant === 0) {
    return { b, c, exactP: 1, chiSquare: null, chiSquareP: null }
  }
  const k = Math.min(b, c)
  let sum = 0
  for (let i = 0; i <= k; i += 1) {
    sum += binomial(discordant, i) / 2 ** discordant
  }
  const exactP = Math.min(1, 2 * sum)
  const chiSquare = (Math.abs(b - c) - 1) ** 2 / discordant
  return { b, c, exactP, chiSquare, chiSquareP: chiSquarePValue(chiSquare, 1) }
}

/** Result of {@link meanConfidenceInterval}. */
export interface MeanCi {
  mean: number
  /** 95% t-based CI; null when fewer than 2 values. */
  ci: [number, number] | null
}

/**
 * 95% confidence interval for a mean via the t distribution:
 * mean +/- t_{0.975, n-1} * SE (spec §7 cost sidecar, mean delta).
 *
 * @param values - the per-session observations.
 * @returns the mean and its CI (mean 0 / CI null when empty).
 */
export function meanConfidenceInterval(values: readonly number[]): MeanCi {
  const n = values.length
  if (n === 0) return { mean: 0, ci: null }
  const mean = values.reduce((sum, v) => sum + v, 0) / n
  if (n < 2) return { mean, ci: null }
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1)
  const se = Math.sqrt(variance) / Math.sqrt(n)
  const margin = se * tQuantile(0.975, n - 1)
  return { mean, ci: [mean - margin, mean + margin] }
}

/**
 * One exported `tool/result` event's erroring payload — mirrors the classifier
 * so the waste-ratio metric reads the SAME real harness log (both wire shapes:
 * a top-level `error` object, or `isError: true` on a `tool-result` block
 * inside `data.message.content[]`). A call that errs contributes nothing, so
 * it is counted as wasted regardless of which shape the log uses.
 */
function wasteIsErroringResult(data: Record<string, unknown>): boolean {
  const error = data.error
  if (error !== null && typeof error === 'object') return true
  const message = data.message
  if (message !== null && typeof message === 'object') {
    const content = (message as Record<string, unknown>).content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block === null || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'tool-result' && b.isError === true) return true
      }
    }
  }
  return false
}

/** True for an fs-family call whose payload hashes cleanly (a no-op candidate). */
function fsCallHasPairablePayload(args: Record<string, unknown>): boolean {
  return typeof args.content === 'string'
    || args.edits !== undefined
    || args.old_str !== undefined || args.new_str !== undefined
    || args.oldStr !== undefined || args.newStr !== undefined
    || args.old_string !== undefined || args.new_string !== undefined
}

/** The file-path argument of an fs-family call (C2 path resolution). */
function fsCallPath(args: Record<string, unknown>): string | undefined {
  const keys = ['path', 'file_path', 'filePath', 'target', 'filename', 'file']
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** The file-content payload of an fs-family call, canonicalised (C2-style). */
function fsCallPayload(args: Record<string, unknown>): unknown {
  if (typeof args.content === 'string') return args.content
  if (args.edits !== undefined) return args.edits
  if (args.old_str !== undefined || args.new_str !== undefined) {
    return { old_str: args.old_str, new_str: args.new_str }
  }
  if (args.oldStr !== undefined || args.newStr !== undefined) {
    return { oldStr: args.oldStr, newStr: args.newStr }
  }
  if (args.old_string !== undefined || args.new_string !== undefined) {
    return { old_string: args.old_string, new_string: args.new_string }
  }
  return args
}

/** Config for {@link computeWasteRatio}. */
export interface WasteRatioConfig {
  /** Tool names whose call writes file content (no-op detection family). */
  fsWriteFamily?: readonly string[]
  /** Tool names whose call edits file content (no-op detection family). */
  fsEditFamily?: readonly string[]
}

/** Result of {@link computeWasteRatio}: per-session wasted-work decomposition. */
export interface WasteRatioResult {
  /** Number of `tool/call` events in the log (the denominator). */
  totalCalls: number
  /** Calls whose paired `tool/result` produced an error. */
  errorCalls: number
  /** File-edit calls that repeated a prior content hash (no-op edits). */
  noopEdits: number
  /** Calls after the last call that contributed to the verified outcome. */
  postOutcomeCalls: number
  /** errorCalls + noopEdits + postOutcomeCalls (the spec's wasted_calls). */
  wastedCalls: number
  /** wastedCalls / totalCalls, 0 when there are no calls (the primary metric). */
  wasteRatio: number
}

/**
 * The pre-registered PRIMARY metric (broaden-design.md §2): the fraction of a
 * session's tool calls that achieved nothing.
 *
 * Per the spec:
 *
 * ```
 * wasted_calls = tool calls that produce isError
 *              + calls whose post-state hash equals pre-state hash (no-op
 *                edits, re-reads of unchanged files)
 *              + calls after the last call that contributed to the verified
 *                outcome
 * waste_ratio  = wasted_calls / total_calls
 * ```
 *
 * Every term is derived deterministically from the exported append-only
 * `tool/call` + `tool/result` event stream — no LLM judgment, same
 * determinism guarantee as the classifier. No-op edits are identified by
 * content-hash equality: an fs-family edit whose canonicalised payload equals
 * a prior edit to the same path changed nothing. Post-outcome calls are traced
 * from the last call whose result was neither an error nor a no-op.
 *
 * @param events - the exported session log events (append-only, `type`+`seq`
 *   intact).
 * @param config - optional fs family names (defaults match the classifier's
 *   write/edit families).
 * @returns the waste decomposition.
 */
export function computeWasteRatio(
  events: readonly SessionLogEvent[],
  config: WasteRatioConfig = {},
): WasteRatioResult {
  const writeFamily = new Set(config.fsWriteFamily ?? ['write_file', 'write', 'create_file', 'read_write_file'])
  const editFamily = new Set(config.fsEditFamily ?? ['patch', 'edit', 'apply', 'str_replace_editor', 'replace'])

  let totalCalls = 0
  let errorCalls = 0
  let noopEdits = 0
  // { path: last content hash } — a no-op edit repeats a prior hash on the
  // same path, so the workspace did not change.
  const lastHashByPath = new Map<string, string>()
  // The last call index that CHANGED STATE (a successful non-noop fs write);
  // every call after it is post-outcome waste because the artifact is complete.
  let lastMutationIndex = -1

  // Walk the append-only stream. Each tool/call records its name + args; the
  // NEXT tool/result, when present, is its result. A tool/call with no
  // subsequent result cannot be judged — count it as productive (do not
  // over-count waste on an incomplete log).
  let openName: string | undefined
  let openArgs: Record<string, unknown> | undefined
  let openError = false
  let openIndex = -1

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i]
    if (ev === undefined) continue
    if (ev.type === 'tool/call') {
      totalCalls += 1
      openIndex = totalCalls - 1
      openName = typeof ev.data.name === 'string' ? ev.data.name : undefined
      openArgs = typeof ev.data.arguments === 'string' ? parseArgs(ev.data.arguments as string) : undefined
      openError = false
    } else if (ev.type === 'tool/result') {
      if (openIndex < 0) continue
      openError = wasteIsErroringResult(ev.data)
      const inFamiliy = openName !== undefined && (writeFamily.has(openName) || editFamily.has(openName))
      let isNoop = false
      if (inFamiliy && openArgs !== undefined && fsCallHasPairablePayload(openArgs)) {
        const path = fsCallPath(openArgs)
        const hash = sha256Hex(canonicalJson(fsCallPayload(openArgs)))
        if (path !== undefined) {
          const prior = lastHashByPath.get(path)
          if (prior !== undefined && prior === hash) isNoop = true
          else lastHashByPath.set(path, hash)
        }
      }
      if (openError) {
        errorCalls += 1
      } else if (isNoop) {
        noopEdits += 1
      } else if (inFamiliy) {
        // A successful, non-noop fs write changed state — it is the last call
        // that contributed to the verified outcome.
        lastMutationIndex = openIndex
      }
      openIndex = -1
      openName = undefined
      openArgs = undefined
    }
  }
  // Post-outcome waste: every call strictly after the last state-mutating
  // (successful non-noop fs write) call. If no call mutated state, there is no
  // verified outcome to be "after", so post-outcome waste is zero (the error /
  // no-op terms already carry those calls).
  let postOutcomeCalls = 0
  if (lastMutationIndex >= 0) {
    postOutcomeCalls = totalCalls - (lastMutationIndex + 1)
  }
  const wastedCalls = errorCalls + noopEdits + postOutcomeCalls
  const wasteRatio = totalCalls > 0 ? wastedCalls / totalCalls : 0
  return { totalCalls, errorCalls, noopEdits, postOutcomeCalls, wastedCalls, wasteRatio }
}

/**
 * Parse a `tool/call` arguments JSON string. Deterministic: a malformed
 * arguments payload yields `undefined` and the call is treated as lacking
 * no-op detection input rather than fabricating one.
 */
function parseArgs(argumentsJson: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** One per-turn waste-ratio segment of a session (broaden-design §2, §4.5). */
export interface TurnWasteSegment {
  /** 0-based turn index. Turn 0 covers events before the first `user/message`. */
  turn: number
  /** Number of `tool/call` events in this turn's slice. */
  totalCalls: number
  /** wastedCalls within this turn's slice (see {@link WasteRatioResult}). */
  wastedCalls: number
  /** wastedCalls / totalCalls in this turn (0 when no calls). */
  wasteRatio: number
}

/** Result of {@link computeTurnWasteRatio}: the session aggregate + per-turn breakdown. */
export interface TurnWasteResult {
  /** The session-level waste decomposition (primary metric for the session). */
  session: WasteRatioResult
  /** Per-turn waste segments in ascending turn order (only turns that ran). */
  turns: TurnWasteSegment[]
}

/**
 * The primary metric measured per turn (broaden-design §4.5): split a session
 * into turns at `user/message` boundaries and report a wage-ratio per turn.
 *
 * Turn semantics: a session begins with the task prompt (`user/message`), then
 * the agent responds across tool calls. A new `user/message` (a follow-up
 * turn in a multi-turn task) starts a new turn. Events before the first
 * `user/message` belong to turn 0.
 *
 * This is a SINGLE pass over the append-only stream that replicates
 * {@link computeWasteRatio}'s exact counting (same no-op hash by path, same
 * error/post-outcome rules) while ALSO assigning every wasted call to the turn
 * it occurred in. Because no-op detection shares one global hash map across
 * turns, a repeat of a PRIOR turn's write is still caught and charged to the
 * turn where the repeat happened — so per-turn wasted calls always sum to the
 * session aggregate (no cross-boundary undercount).
 *
 * @param events - the exported session log events (append-only).
 * @param config - fs-family names (defaults match computeWasteRatio).
 * @returns the session aggregate + per-turn slices.
 */
export function computeTurnWasteRatio(
  events: readonly SessionLogEvent[],
  config: WasteRatioConfig = {},
): TurnWasteResult {
  const writeFamily = new Set(config.fsWriteFamily ?? ['write_file', 'write', 'create_file', 'read_write_file'])
  const editFamily = new Set(config.fsEditFamily ?? ['patch', 'edit', 'apply', 'str_replace_editor', 'replace'])

  let totalCalls = 0
  let errorCalls = 0
  let noopEdits = 0
  const lastHashByPath = new Map<string, string>()
  let lastMutationIndex = -1

  // Per-turn totals, keyed by turn index. Turn index increments on each
  // `user/message`. The current turn starts at 0.
  const turnCalls: number[] = []
  const turnWasted: number[] = []
  let turnIndex = 0

  let openName: string | undefined
  let openArgs: Record<string, unknown> | undefined
  let openError = false
  let openIndex = -1

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i]
    if (ev === undefined) continue
    if (ev.type === 'user/message' && i > 0) {
      // A follow-up user message delimitates the previous turn and starts a
      // new one. (The first user/message is the opening prompt — it starts
      // turn 0 and does not advance the counter.)
      turnIndex += 1
    }
    if (ev.type === 'tool/call') {
      totalCalls += 1
      openIndex = totalCalls - 1
      openName = typeof ev.data.name === 'string' ? ev.data.name : undefined
      openArgs = typeof ev.data.arguments === 'string' ? parseArgs(ev.data.arguments) : undefined
      openError = false
    } else if (ev.type === 'tool/result') {
      if (openIndex < 0) continue
      openError = wasteIsErroringResult(ev.data)
      const inFamiliy = openName !== undefined && (writeFamily.has(openName) || editFamily.has(openName))
      let isNoop = false
      if (inFamiliy && openArgs !== undefined && fsCallHasPairablePayload(openArgs)) {
        const path = fsCallPath(openArgs)
        const hash = sha256Hex(canonicalJson(fsCallPayload(openArgs)))
        if (path !== undefined) {
          const prior = lastHashByPath.get(path)
          if (prior !== undefined && prior === hash) isNoop = true
          else lastHashByPath.set(path, hash)
        }
      }
      turnCalls[turnIndex] = (turnCalls[turnIndex] ?? 0) + 1
      if (openError) {
        errorCalls += 1
        turnWasted[turnIndex] = (turnWasted[turnIndex] ?? 0) + 1
      } else if (isNoop) {
        noopEdits += 1
        turnWasted[turnIndex] = (turnWasted[turnIndex] ?? 0) + 1
      } else if (inFamiliy) {
        lastMutationIndex = openIndex
      }
      openIndex = -1
      openName = undefined
      openArgs = undefined
    }
  }
  // Post-outcome waste: every call strictly after the last state-mutating
  // (successful non-noop fs write) call is wasted. It belongs to the turn it
  // occurred in, so walk the open-call indices backwards from the end and
  // charge each to its turn. All calls after lastMutationIndex are wasted.
  let postOutcomeCount = 0
  if (lastMutationIndex >= 0) {
    // Rebuild per-call turn ownership by scanning the call order: the k-th
    // tool/call (1-based index = k+1... here k is 0-based openIndex, so
    // callNumber = lastMutationIndex + 1) belongs to the turn of that call.
    // We track turn ownership per call number in a parallel map while
    // scanning events once more (cheap, deterministic).
    const callTurn: number[] = []
    let t = 0
    for (let i = 0; i < events.length; i += 1) {
      const ev = events[i]
      if (ev === undefined) continue
      if (ev.type === 'user/message' && i > 0) t += 1
      if (ev.type === 'tool/call') callTurn.push(t)
    }
    // All calls with 0-based index > lastMutationIndex are post-outcome waste.
    for (let k = lastMutationIndex + 1; k < totalCalls; k += 1) {
      const tc = callTurn[k]
      if (tc !== undefined) {
        turnWasted[tc] = (turnWasted[tc] ?? 0) + 1
        postOutcomeCount += 1
      }
    }
  }

  const wastedCalls = errorCalls + noopEdits + postOutcomeCount
  const wasteRatio = totalCalls > 0 ? wastedCalls / totalCalls : 0
  const session: WasteRatioResult = { totalCalls, errorCalls, noopEdits, postOutcomeCalls: postOutcomeCount, wastedCalls, wasteRatio }

  // Emit per-turn segments (ascending turn; only turns that ran a call).
  const turns: TurnWasteSegment[] = []
  for (let i = 0; i < turnCalls.length; i += 1) {
    const tc = turnCalls[i]
    if (tc === undefined || tc === 0) continue
    const tw = turnWasted[i] ?? 0
    turns.push({ turn: i, totalCalls: tc, wastedCalls: tw, wasteRatio: tc > 0 ? tw / tc : 0 })
  }
  return { session, turns }
}

/**
 * One per-turn observation of a task (broaden-design §4.5 n-gain): each
 * running turn of a multi-turn task contributes ONE observation, so a
 * 3-turn task yields 3 paired points instead of 1. This is the unit that
 * turns the per-turn segments into reportable paired data.
 */
export interface TurnObservation {
  taskId: string
  /** 0-based turn index (see {@link TurnWasteSegment}). */
  turn: number
  totalCalls: number
  wastedCalls: number
  wasteRatio: number
}

/** Result of {@link computeTurnAggregate}: the turn-level observation set. */
export interface TurnAggregate {
  /** Every (task, turn) observation that ran a call, ascending task then turn. */
  observations: TurnObservation[]
  /** Length of observations = the per-turn n for the paired test (vs tasks). */
  observationCount: number
  /** Tasks with at least two running turns (true multi-turn tasks). */
  multiTurnTaskCount: number
  /** Mean per-turn waste ratio across all observations (0 when none). */
  meanWasteRatio: number
}

/**
 * The turn-level AGGREGATE of the primary metric (broaden-design §4.5): fold a
 * collection of sessions' per-turn segments into a flat observation set — one
 * observation per (task, running turn). A multi-turn task contributes as many
 * paired points as it has turns (3-6 for the spec's load-bearing tasks),
 * replacing the single per-task point of the old concentration. Deterministic
 * pure function of its inputs.
 *
 * @param sessions - per-session per-turn segments (typically the `turns` field
 *   of the run log / counts rows).
 * @returns the observation set + summary stats.
 */
export function computeTurnAggregate(
  sessions: ReadonlyArray<{ taskId: string; turns: readonly TurnWasteSegment[] }>,
): TurnAggregate {
  const observations: TurnObservation[] = []
  let multiTurnTaskCount = 0
  for (const session of sessions) {
    let runningTurns = 0
    for (const segment of session.turns) {
      if (segment.totalCalls === 0) continue
      runningTurns += 1
      observations.push({
        taskId: session.taskId,
        turn: segment.turn,
        totalCalls: segment.totalCalls,
        wastedCalls: segment.wastedCalls,
        wasteRatio: segment.wasteRatio,
      })
    }
    if (runningTurns > 1) multiTurnTaskCount += 1
  }
  // Deterministic ordering: ascending taskId, then ascending turn.
  observations.sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : a.turn - b.turn))
  const observationCount = observations.length
  const meanWasteRatio = observationCount > 0
    ? observations.reduce((sum, o) => sum + o.wasteRatio, 0) / observationCount
    : 0
  return { observations, observationCount, multiTurnTaskCount, meanWasteRatio }
}

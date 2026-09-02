// Predictive failure signals: threshold checks over the metrics. Pure — no
// I/O, no `this`. Signal order is fixed; empty streams never signal.

import { SIGNAL_THRESHOLDS } from './metrics.ts'
import type { FailureSignal, SignalMetrics, SignalReport } from './types.ts'

/**
 * Operator-tunable threshold overrides. Widened from the literal-typed
 * `typeof SIGNAL_THRESHOLDS` so config values (any number) are assignable —
 * the literal `as const` types are the defaults, not the config contract.
 */
export type SignalThresholds = Partial<Record<keyof typeof SIGNAL_THRESHOLDS, number>>

/**
 * Evaluate the predictive failure signals against the metrics.
 *
 * @param metrics - the aggregated stream metrics.
 * @param thresholds - optional threshold overrides (defaults from
 *   SIGNAL_THRESHOLDS).
 * @returns the firing signals in canonical order; empty when the stream has
 *   no classified events.
 */
export function evaluateSignals(metrics: SignalMetrics, thresholds?: SignalThresholds): FailureSignal[] {
  if (metrics.totalEvents === 0) return []
  const limits = { ...SIGNAL_THRESHOLDS, ...thresholds }
  const signals: FailureSignal[] = []
  if (metrics.pRatio > limits.pRatioAlarm) {
    signals.push({
      id: 'high-p-ratio',
      severity: 'alarm',
      detail: `planning ratio ${metrics.pRatio.toFixed(2)} exceeds alarm ${limits.pRatioAlarm}`,
    })
  }
  if (metrics.eToV < limits.evDeficitWarn) {
    signals.push({
      id: 'e-to-v-deficit',
      severity: 'warn',
      detail: `verify/evaluate+verify ratio ${metrics.eToV.toFixed(2)} below warn ${limits.evDeficitWarn}`,
    })
  }
  if (metrics.pxpSpirals > 0) {
    signals.push({
      id: 'plan-explore-plan-spiral',
      severity: 'alarm',
      detail: `${metrics.pxpSpirals} plan-explore-plan trigram(s)`,
    })
  }
  if (metrics.maxRepeatRun >= limits.repeatThreshold) {
    signals.push({
      id: 'repeated-identical-calls',
      severity: 'alarm',
      detail: `${metrics.maxRepeatRun} consecutive identical calls`,
    })
  }
  return signals
}

/**
 * Compose the full signal report.
 *
 * @param metrics - the aggregated stream metrics.
 * @param thresholds - optional threshold overrides (defaults from
 *   SIGNAL_THRESHOLDS).
 * @returns the report: metrics, firing signals, and the verdict (any alarm →
 *   ALARM, else any warn → WARN, else CLEAR).
 */
export function composeReport(metrics: SignalMetrics, thresholds?: SignalThresholds): SignalReport {
  const signals = evaluateSignals(metrics, thresholds)
  const verdict = signals.some(signal => signal.severity === 'alarm')
    ? 'ALARM'
    : signals.some(signal => signal.severity === 'warn')
      ? 'WARN'
      : 'CLEAR'
  return { metrics, signals, verdict }
}

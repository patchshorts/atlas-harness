// Signal metrics: a single left-to-right fold over the event stream. Pure —
// no I/O, no `this`, and the input array is never mutated (golden rule).

import { OBS_STAGES } from './stages.ts'
import type { ObsEvent, SignalMetrics } from './types.ts'

/** Default signal thresholds; operator config may override them. */
export const SIGNAL_THRESHOLDS = {
  pRatioAlarm: 0.5,
  evDeficitWarn: 0.1,
  repeatThreshold: 3,
} as const

/**
 * Compute the predictive-failure metrics over an event stream in one
 * left-to-right fold (sliding three-stage window for the plan→explore→plan
 * trigram, run tracking for repeated identical calls).
 *
 * @param events - the event stream to fold over; never mutated.
 * @returns the aggregated metrics: totalEvents, pRatio, eToV, pxpSpirals,
 *   and maxRepeatRun.
 */
export function computeMetrics(events: readonly ObsEvent[]): SignalMetrics {
  let totalEvents = 0
  let planCount = 0
  let evaluateCount = 0
  let verifyCount = 0
  let pxpSpirals = 0
  let maxRepeatRun = 0
  let run = 0
  let previous: ObsEvent | undefined
  let twoBack: ObsEvent['stage'] | undefined
  let oneBack: ObsEvent['stage'] | undefined

  for (const event of events) {
    if (OBS_STAGES.includes(event.stage)) {
      totalEvents++
      if (event.stage === 'plan') planCount++
      else if (event.stage === 'evaluate') evaluateCount++
      else if (event.stage === 'verify') verifyCount++
    }
    if (twoBack === 'plan' && oneBack === 'explore' && event.stage === 'plan') {
      pxpSpirals++
    }
    run = previous !== undefined
      && event.kind === previous.kind
      && (event.detail ?? '') === (previous.detail ?? '')
      ? run + 1
      : 1
    if (run > maxRepeatRun) maxRepeatRun = run
    twoBack = oneBack
    oneBack = event.stage
    previous = event
  }

  const verifyable = evaluateCount + verifyCount
  return {
    totalEvents,
    pRatio: totalEvents === 0 ? 0 : planCount / totalEvents,
    eToV: verifyable === 0 ? 0 : verifyCount / verifyable,
    pxpSpirals,
    maxRepeatRun,
  }
}

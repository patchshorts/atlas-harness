/**
 * Alarm detectors over the runtime event stream.
 *
 * Each detector is a PURE fold over a replayable event projection. It returns
 * alarm objects; it NEVER mutates the stream, an event, or the input array.
 * Detectors are single-pass: each folds once over the events and collects
 * alarms as it goes, so the same event is never double-consume (the monotonic
 * `seq` cursor in the underlying stream already prevents re-emission).
 *
 * ## Golden rule
 *
 * Detectors are diagnostic projections. They read the event stream; they never
 * write model-visible history. No detector touches message history, session
 * state, or the live stream buffer.
 *
 * @module @atlasai/atsh-runtime-alarms/src/detectors
 */

import type { RuntimeEvent } from '@atlasai/atsh-runtime-events'
import type {
  Alarm,
  EvidenceDeficitOptions,
  PRatioOptions,
  RepeatedCallOptions,
} from './types.ts'

/** The alarm kinds this module contributes, in stable detection order. */
export const ALARM_KINDS = ['evidence-deficit', 'p-ratio', 'repeated-call'] as const

/**
 * Detect an evidence-to-verdict deficit: a judge vote that carries no (or
 * trivially short) evidence while casting a verdict.
 *
 * The three-panel contract is unanimity with evidence-based dissent, NOT
 * averaging. A verdict without evidence cannot participate in that contract —
 * it is a bare assertion dressed as a ballot.
 *
 * @param events - the replayable event projection to fold over.
 * @param options - detector tuning (see {@link EvidenceDeficitOptions}).
 * @returns alarms, one per offending vote, in stream order.
 */
export function detectEvidenceDeficit(
  events: readonly RuntimeEvent[],
  options: EvidenceDeficitOptions = {},
): readonly Alarm[] {
  const minChars = options.minEvidenceChars ?? 1
  const alarms: Alarm[] = []
  for (const event of events) {
    if (event.kind !== 'judge/vote') continue
    const details = event.evidence ?? ''
    if (details.trim().length < minChars) {
      alarms.push({
        kind: 'evidence-deficit',
        severity: event.vote === 'replan' ? 'critical' : 'warning',
        seq: event.seq,
        message: `judge ${event.voter} cast "${event.vote}" with ${
          details.length === 0 ? 'no evidence' : `only ${details.length} evidence chars`
        }`,
      })
    }
  }
  return alarms
}

/**
 * Detect a P-Ratio efficiency collapse: the runtime burns input tokens without
 * producing proportional output across a model-call window.
 *
 * P-Ratio = output tokens / (input + output tokens) over the model calls seen.
 * A ratio below `minOutputFraction` means most of the token spend is input:
 * retries, re-prompting, or pathologically long context with tiny completions.
 * The alarm reports the aggregate ratio and the window's token counts.
 *
 * @param events - the runtimeable event stream to fold over.
 * @param options - detector tuning (optional {@link PRatioOptions}).
 * @returns zero alarms when there are no model calls or the ratio holds; one
 *   alarm naming the first model call that completed the failing window.
 */
export function detectPRatio(
  events: readonly RuntimeEvent[],
  options: PRatioOptions = {},
): readonly Alarm[] {
  const minFraction = options.minOutputFraction ?? 0.15
  let inputTokens = 0
  let outputTokens = 0
  let firstModelSeq = -1
  for (const event of events) {
    if (event.kind !== 'model/call') continue
    if (firstModelSeq === -1) firstModelSeq = event.seq
    inputTokens += (event.inputTokens ?? 0)
    outputTokens += (event.outputTokens ?? 0)
  }
  if (firstModelSeq === -1) return []
  const total = inputTokens + outputTokens
  if (total <= 0) return []
  const ratio = outputTokens / total
  if (ratio >= minFraction) return []
  return [{
    kind: 'p-ratio',
    severity: 'critical',
    seq: firstModelSeq,
    message: `P-Ratio ${ratio.toFixed(3)} below min ${minFraction.toFixed(3)} ` +
      `(${outputTokens} out / ${inputTokens} in)`,
  }]
}

/**
 * Detect repeated-call loops: the same tool called repeatedly with no progress
 * between calls.
 *
 * In strict mode a run is consecutive identical tool calls with no other event
 * kind between them; in loose mode any sequence of the same tool (other events
 * allowed between) reaching the threshold also raises. The detector fires a
 * `warning` alarm at the threshold crossing and escalates to a second
 * `critical` alarm when the same run persists at least one call past the
 * threshold. Each level fires once per run, naming the tool and the run start.
 *
 * @param events - the runtime event stream to fold over.
 * @param options - detector tuning (optional {@link RepeatedCallOptions}).
 * @returns one alarm per firing level (warning then, if the run persists,
 * critical), in stream order.
 */
export function detectRepeatedCalls(
  events: readonly RuntimeEvent[],
  options: RepeatedCallOptions = {},
): readonly Alarm[] {
  const threshold = options.repeatThreshold ?? 3
  const strict = options.strictConsecutive ?? true
  const alarms: Alarm[] = []
  let runTool: string | undefined
  let runStartSeq = -1
  let runCount = 0
  let warningFired = false
  let criticalFired = false
  for (const event of events) {
    if (event.kind === 'tool/call') {
      if (event.tool === runTool) {
        runCount += 1
      } else {
        runTool = event.tool
        runStartSeq = event.seq
        runCount = 1
        warningFired = false
        criticalFired = false
      }
      // runTool is always a string here: the if/else above either kept an
      // existing tool (=== string) or assigned event.tool. No undefined guard.
      if (runCount >= threshold && !warningFired) {
        alarms.push({
          kind: 'repeated-call',
          severity: 'warning',
          seq: runStartSeq,
          message: `tool "${runTool}" called ${runCount}x in a row`,
        })
        warningFired = true
      } else if (runCount >= threshold + 1 && !criticalFired) {
        // Run persists past the threshold: escalate. This branch was previously
        // unreachable because `fired` was set at the crossing (runCount ===
        // threshold), so severity always evaluated `warning`. Fixed so critical
        // is reachable on an identifiable persisting run.
        alarms.push({
          kind: 'repeated-call',
          severity: 'critical',
          seq: runStartSeq,
          message: `tool "${runTool}" called ${runCount}x in a row`,
        })
        criticalFired = true
      }
      continue
    }
    // Non-tool event.
    if (strict) {
      // Any other event kind breaks a strict consecutive run.
      runTool = undefined
      runCount = 0
      warningFired = false
      criticalFired = false
    }
  }
  return alarms
}

/**
 * Run every detector once over the stream and return all alarms.
 *
 * Detectors run in fixed order and each folds the stream exactly once. The
 * returned array is a fresh projection of the inputs — never a mutation of
 * `events` or any event object.
 *
 * @param events - the runtime event stream to fold over.
 * @param options - per-kind tuning, each optional.
 * @returns alarms from all detectors, grouped by kind in stable order.
 */
export function detectAlarms(
  events: readonly RuntimeEvent[],
  options: {
    readonly pRatio?: PRatioOptions
    readonly evidenceDeficit?: EvidenceDeficitOptions
    readonly repeatedCall?: RepeatedCallOptions
  } = {},
): readonly Alarm[] {
  const alarms: Alarm[] = []
  for (const kind of KIND_ORDER) {
    switch (kind) {
      case 'evidence-deficit':
        alarms.push(...detectEvidenceDeficit(events, options.evidenceDeficit))
        break
      case 'p-ratio':
        alarms.push(...detectPRatio(events, options.pRatio))
        break
      case 'repeated-call':
        alarms.push(...detectRepeatedCalls(events, options.repeatedCall))
        break
    }
  }
  return alarms
}

/** Stable per-kind run order for {@link detectAlarms}. */
const KIND_ORDER = ALARM_KINDS

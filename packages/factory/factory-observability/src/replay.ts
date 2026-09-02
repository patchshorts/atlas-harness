// Replay-with-patch: the debugging substrate. Patch one event in a recorded
// stream and observe which signals change — the error's surfacing step is not
// necessarily the cause step. Pure — the input array is never mutated
// (golden rule); the patched stream is a NEW array.

import { computeMetrics } from './metrics.ts'
import { composeReport } from './signals.ts'
import type { SignalThresholds } from './signals.ts'
import type { ObsEvent, ReplayPatch, ReplayResult } from './types.ts'

/**
 * Replay the recorded stream with one event replaced by the patch.
 *
 * @param events - the recorded stream; never mutated.
 * @param patch - the patch: the event index to replace and the replacement
 *   event.
 * @param thresholds - optional signal threshold overrides.
 * @returns the before/after reports and the signal ids whose report entry
 *   (presence, severity, or detail) changed, sorted and deduped.
 * @throws {RangeError} When `patch.index` is out of bounds.
 */
export function replayWithPatch(
  events: readonly ObsEvent[],
  patch: ReplayPatch,
  thresholds?: SignalThresholds,
): ReplayResult {
  if (patch.index < 0 || patch.index >= events.length) {
    throw new RangeError('replay patch index out of bounds')
  }
  const before = composeReport(computeMetrics(events), thresholds)
  const patched = [...events]
  patched[patch.index] = patch.event
  const after = composeReport(computeMetrics(patched), thresholds)

  const beforeById = new Map(before.signals.map(signal => [signal.id, signal] as const))
  const afterById = new Map(after.signals.map(signal => [signal.id, signal] as const))
  const changed = new Set<string>()
  for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
    const beforeSignal = beforeById.get(id)
    const afterSignal = afterById.get(id)
    if (beforeSignal === undefined
      || afterSignal === undefined
      || beforeSignal.severity !== afterSignal.severity
      || beforeSignal.detail !== afterSignal.detail) {
      changed.add(id)
    }
  }
  return { before, after, changed: [...changed].sort() }
}

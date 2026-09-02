// Stage classification: the deterministic kind → stage map. Pure — no I/O,
// no `this`. The map is a contract, not a model pass: kinds outside it are
// unclassified and never counted in metrics.

import type { ObsStage } from './types.ts'

/** The classified stages, in canonical order. */
export const OBS_STAGES: readonly ObsStage[] = ['plan', 'explore', 'evaluate', 'verify']

const KIND_STAGE: Readonly<Record<string, ObsStage>> = {
  'judge/ballot': 'evaluate',
  'judge/verdict': 'verify',
  'judge/replan': 'plan',
  'budget/route': 'explore',
  'budget/veto': 'evaluate',
  'lane/veto': 'evaluate',
  'factory/contract-registered': 'plan',
}

/**
 * Classify an event kind into a stage.
 *
 * @param kind - the source event kind (compared case-insensitively).
 * @returns the classified stage, or null when the kind is unknown
 *   (unclassified events are not counted in metrics).
 */
export function stageOfKind(kind: string): ObsStage | null {
  return KIND_STAGE[kind.toLowerCase()] ?? null
}

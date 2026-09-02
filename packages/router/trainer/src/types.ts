/**
 * Canonical types for `@atlasai/atsh-router-trainer`. Types only — no runtime code.
 * @module @atlasai/atsh-router-trainer/types
 */

import type { RouterCallRecord } from '@atlasai/atsh-router'

/**
 * One correction threaded into the trainer's sample log as a reward signal for a
 * routed call. Corrections are post-hoc signals (a retried failed tool, a file revert,
 * a self-correction, a plan repair, a user correction) that mark one routed call's
 * routing decision as worth revisiting.
 */
export interface CorrectionRecord {
  /** Correction record id (UUID). */
  id: string
  /** The `RouterCallRecord.id` this correction rewards (penalizes). */
  callId: string
  /** Correction timestamp (epoch ms). */
  ts: number
  /** Correction class when known (the bench C1..C5 family, or a free label). */
  classification?: string
  /** Concise reason for the correction. */
  note?: string
}

/**
 * One routed model call as captured for training, kept in arrival order, with the
 * optional reward a correction threaded onto it.
 */
export interface TrainingSample extends RouterCallRecord {
  /**
   * Set when a correction referenced this call (by `RouterCallRecord.id`): the
   * correction consumed as a reward signal for the route. Absent on uncorrected calls.
   */
  reward?: CorrectionRecord
}

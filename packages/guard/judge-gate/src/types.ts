// Canonical type contracts for the three-panel judge gate (`ctx.judgeGate`).
// Types only — no runtime code. The runtime JudgeGateError class and the
// JudgeGateService live in service.ts (package implementer owns them).

import type {
  JudgePlanTask,
  JudgeSubmission,
  JudgeVerdict,
} from '@atlasai/atsh-factory-judge'

/** Configuration for the judge gate service. */
export interface JudgeGateConfig {
  /** Whether the gate accepts judgments. Default true. */
  enabled?: boolean
  /** Maximum replans per judgment before escalation. Default 2 (D2: N≤2). */
  maxReplans?: number
  /** Completion/exit votes require a prior plan approval. Default true. */
  requirePlanApproval?: boolean
}

/** Plan admission input: the presented plan, identified for judging. */
export interface JudgeGateAdmissionInput {
  /** The plan id under judgment (session id + ':plan' by the caller). */
  planId: string
  /** The plan revision (presentation ordinal — a re-present after a NO bumps it). */
  revision: string
  /** The plan markdown exactly as presented to the user. */
  planMarkdown: string
}

/** Completion or exit-review input: the admitted plan plus a claimed submission. */
export interface JudgeGateCompletionInput {
  /** The plan id under judgment. */
  planId: string
  /** The admitted plan revision being completed or exited. */
  revision: string
  /** The claimed completion: summary plus evidence and file paths. */
  submission: JudgeSubmission
}

/**
 * Shape of the error thrown when the gate rejects (fail-closed: the plan or
 * claim does not pass the panel). Carries the verdict and every ballot so the
 * model can revise with exact artifact-citing reasons.
 */
export interface JudgeGateError {
  readonly name: 'JudgeGateError'
  /** Human-readable rejection message. */
  readonly message: string
  /** The settled verdict (REPLAN or ESCALATE — never PASS). */
  readonly verdict: JudgeVerdict
  /** The parsed plan tasks that were judged (empty when unparseable). */
  readonly tasks: JudgePlanTask[]
  /** Every NO reason across the round's ballots, exact and artifact-citing. */
  readonly reasons: string[]
}

/** The parsed task rows of a plan; the pure parser output. */
// (JudgePlanTask is imported from @atlasai/atsh-factory-judge above.)

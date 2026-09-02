/**
 * Cost-cap + guardrail enforcement for the prompt-lume self-extension seam.
 *
 * The acquisition registry (extend.ts) exposes WHAT is available and the miss
 * fallback (widen.ts) rescues a retrieval miss by widening the hook. Neither
 * enforces a budget — this module is the enforcement layer that decides WHEN
 * the extension may land, within a hard cost/quality cap and an approval gate.
 *
 * A {@link SelfExtensionBudget} caps (a) how many capabilities may be acquired
 * per turn (maxCandidates), (b) how far the region byte-budget ceiling may be
 * raised by widening (maxBudgetBytes), and (c) how many escalation steps the
 * widen ladder may traverse (maxWidenSteps). The guarded extension HONORS the
 * cap: widened results are clamped to it before any candidate is reported or
 * approved, and the outcome flags `capped` when a cap bit the turn.
 *
 * Guardrails: the extension never auto-adds a tool. Produced candidates must
 * pass an {@link ApprovalGate} before they become an approved addition plan;
 * the default gate denies everything (the sandboxed/no-auto-add safety rule).
 * The outcome is a DETACHED plan — nothing is registered, mounted, or mutated;
 * no model-visible history is touched. A caller (agent approval, sandbox edge)
 * decides whether to apply the plan later.
 *
 * Purely additive and deterministic (mirrors extend.ts / widen.ts): no LLM
 * provider, no context, no global state.
 *
 * @module
 */

import {
  CapabilityRegistry,
  type CapabilityCandidate,
  type LookupOptions,
} from './extend.ts'
import { widenOnMiss, type WidenPolicy } from './widen.ts'

/**
 * The budget + guardrails contract that bounds a single self-extension turn.
 *
 * Every cap is a HARD ceiling — a widened result is clamped to these numbers
 * before any candidate is reported or approved; the extension never exceeds
 * them. Smaller caps = a more conservative extension.
 */
export interface SelfExtensionBudget {
  /** @summary Hard ceiling on how many capabilities may be acquired per turn. */
  maxCandidates: number
  /**
   * @summary Hard ceiling on the region byte-budget the widen ladder may raise
   * the hook budget to. A step wanting more is clamped to this ceiling.
   */
  maxBudgetBytes: number
  /** @summary Max escalation steps the widen ladder may traverse (default: all). */
  maxWidenSteps?: number
}

/**
 * Approval gate for a produced capability candidate.
 *
 * The extension never auto-adds a tool: a candidate must be explicitly
 * approved before it lands in the addition plan. The gate is a pure
 * predicate — deterministic, no side effects; run once per candidate.
 *
 * @returns true when the candidate is approved (becomes a would-be addition);
 * false when it is denied (the candidate is reported but not added).
 */
export type ApprovalGate = (candidate: CapabilityCandidate) => boolean

/** A gate that denies every candidate — the safe default (no auto-add). */
export const DENY_ALL: ApprovalGate = () => false

/**
 * The guarded, approval-gated decision for one self-extension turn.
 *
 * Detached and immutable: `approved` (and `rejected`) carry candidates only;
 * nothing is registered or mounted. A caller decides whether to apply the
 * approved additions later.
 */
export interface GuardedDecision {
  /** Candidates that passed the approval gate (the would-be additions plan). */
  approved: CapabilityCandidate[]
  /** Candidates the gate denied (reported but not added). */
  rejected: CapabilityCandidate[]
  /**
   * True when a hard budget cap (candidates, bytes, or steps) bit the turn:
   * the wide-registered result was larger than the cap allowed.
   */
  capped: boolean
  /**
   * The effective region byte-budget ceiling after caps: the fired widen
   * step's budget clamped to maxBudgetBytes, else the base budget.
   */
  budgetBytes: number
  /**
   * The widen policy step that fired (0-based). Undefined when no widening
   * occurred (base hit, or every step missed / was capped away).
   */
  step?: number
  /** Derived provenance line marking the capped/approved guard outcome. */
  provenanceLine: string
}

/**
 * Guard the self-extension surface: run the widen-on-miss fallback, clamp the
 * result to the {@link SelfExtensionBudget} caps, and gate candidates through
 * the {@link ApprovalGate}.
 *
 * Honors the cap in three places:
 *  1. The widen ladder only traverses up to `maxWidenSteps` steps.
 *  2. A fired step's raised region byte-budget is clamped to `maxBudgetBytes`.
 *  3. Returned candidates are sliced to `maxCandidates`.
 *
 * A base hit passes through the same caps. Every-step-miss still reports a
 * miss (finite wall) — the guard never fabricates a rescue.
 *
 * @param registry - the acquisition registry to consult.
 * @param query - the turn's working intent / capability query.
 * @param base - the strict lookup that missed (its options seed the ladder).
 * @param baseBudgetBytes - the strict region byte budget (widening may raise it).
 * @param policy - the ordered escalation ladder.
 * @param budget - the hard caps the extension must honor.
 * @param gate - the approval gate (default {@link DENY_ALL}; no auto-add).
 * @returns a detached {@link GuardedDecision}; nothing is registered or mutated.
 */
export function guardExtension(
  registry: CapabilityRegistry,
  query: string,
  base: LookupOptions,
  baseBudgetBytes: number,
  policy: WidenPolicy,
  budget: SelfExtensionBudget,
  gate: ApprovalGate = DENY_ALL,
): GuardedDecision {
  // Clamp the ladder to the max-widen-steps cap before running it.
  const steps = budget.maxWidenSteps ? policy.steps.slice(0, budget.maxWidenSteps) : policy.steps
  const clampedPolicy: WidenPolicy = { label: policy.label, steps }

  const widen = widenOnMiss(registry, query, base, baseBudgetBytes, clampedPolicy)

  // Clamp the byte-budget ceiling to maxBudgetBytes.
  const budgetBytes = Math.min(widen.budgetBytes, budget.maxBudgetBytes)

  // Clamp the candidates to maxCandidates; track whether a cap bit the turn.
  const candidates = widen.candidates.slice(0, budget.maxCandidates)
  const capped =
    widen.candidates.length > budget.maxCandidates || widen.budgetBytes > budget.maxBudgetBytes

  // Gate the capped candidates into approved / rejected plans. The gate runs
  // on the SURFACE (every registered candidate has already been decided);
  // approved are the would-be additions, rejected are reported-but-not-added.
  const approved: CapabilityCandidate[] = []
  const rejected: CapabilityCandidate[] = []
  for (const candidate of candidates) {
    if (gate(candidate)) approved.push(candidate)
    else rejected.push(candidate)
  }

  const widenMarker = widen.widened ? `widen=step${widen.step}` : 'widen=noop'
  const capMarker = capped ? ' capped=1' : ''
  const gateMarker = `approved=${approved.length}`
  const provenanceLine =
    `[prompt-lume:acquisition] ${widenMarker} budget=${budgetBytes}${capMarker} ${gateMarker}`

  // exactOptionalPropertyTypes forbids an explicit `undefined` on `step`; only
  // include the property when a widen step actually fired.
  const decision: GuardedDecision = {
    approved,
    rejected,
    capped,
    budgetBytes,
    provenanceLine,
  }
  if (widen.step !== undefined) decision.step = widen.step
  return decision
}

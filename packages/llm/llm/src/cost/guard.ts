/**
 * Budget enforcement for per-session model-call spending.
 *
 * The guard wraps a {@link CostLedger} with a hard ceiling: once a session has
 * spent at least its budget, every further call in that session is refused.
 * The guard only reads the ledger — it never reads or writes history, session
 * logs, or projections (golden rule by construction).
 *
 * @module @atlasai/atsh-llm/cost/guard
 */

import { LlmError, type LlmErrorOptions } from '../error.ts'
import type { CostLedger } from './ledger.ts'

/** Stable machine code for a refused over-budget call. */
export const BUDGET_EXCEEDED_CODE = 'BUDGET_EXCEEDED'

/** Verdict for one model call against a session budget. */
export interface BudgetDecision {
  /** Whether the call may proceed. */
  allowed: boolean
  /** Stable machine code present when refused; absent when allowed. */
  reason?: typeof BUDGET_EXCEEDED_CODE
  /** The model the decision was computed for. */
  model: string
}

/** Per-session budget check seam, consulted before the llm/stream waterfall. */
export interface BudgetGuard {
  /**
   * Whether a call for `model` is still within its session budget.
   *
   * The boundary is exact: a session that has spent exactly the budget is
   * refused (deterministic refusal at the limit). Absent `sessionKey` means
   * the default session.
   */
  check(model: string, sessionKey?: string): BudgetDecision
}

/**
 * Typed error for a refused over-budget call.
 *
 * Extends {@link LlmError}, so existing LlmError consumers (retry policy,
 * replay, tool results) keep handling it; the stable code is
 * `BUDGET_EXCEEDED`.
 */
export class LlmBudgetError extends LlmError {
  constructor(message: string, options?: LlmErrorOptions) {
    super(message, BUDGET_EXCEEDED_CODE, options)
    this.name = 'LlmBudgetError'
  }
}

/**
 * Builds a budget guard over one ledger with a fixed per-session ceiling.
 *
 * @param ledger - the accumulated-cost source; the guard only reads it.
 * @param budgetCents - ceiling in USD cents; a session at or above it refuses.
 */
export function createBudgetGuard(ledger: CostLedger, budgetCents: number): BudgetGuard {
  return {
    check(model, sessionKey) {
      if (ledger.overBudget(budgetCents, sessionKey)) {
        return { allowed: false, reason: BUDGET_EXCEEDED_CODE, model }
      }
      return { allowed: true, model }
    },
  }
}

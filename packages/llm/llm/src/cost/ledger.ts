/**
 * Per-session token-cost ledger (pure accumulator, no side effects).
 *
 * The ledger turns usage chunks into USD-cent totals per session: it only
 * ever adds the cost of the tokens it is handed, and it never reads or
 * writes history, session logs, or projections. A model with no entry in the
 * configured rate table costs 0 cents and is flagged (never NaN, never
 * negative) so callers can see that a price was missing rather than free.
 *
 * @module @atlasai/atsh-llm/cost/ledger
 */

import type { TokenUsage } from '../types.ts'
import type { ModelRateTable } from './rates.ts'

/** Session key used when a caller omits one. */
export const DEFAULT_SESSION = 'default'

/**
 * Accumulates model-call costs in USD cents, keyed by session.
 *
 * Sessions are independent: recording usage into one session never affects
 * another. The ledger observes usage only and has no knowledge of message
 * history or the session log.
 */
export class CostLedger {
  private readonly rates: ModelRateTable
  private readonly spentBySession = new Map<string, number>()
  private readonly unratedBySession = new Map<string, string[]>()

  /** @param rates - Per-model pricing table; an empty table prices nothing. */
  constructor(rates: ModelRateTable = {}) {
    this.rates = rates
  }

  /**
   * Adds one usage chunk's cost (in USD cents) to the session total.
   *
   * Cost = (inputTokens*inputPerM + outputTokens*outputPerM +
   * (cacheReadTokens ?? 0)*(cacheReadPerM ?? 0) +
   * (cacheWriteTokens ?? 0)*(cacheWritePerM ?? 0)) / 1_000_000.
   * Absent tokens and absent cache prices count as zero, so the result is
   * always a finite number. A model with no rate entry costs 0 and is
   * flagged via {@link unratedModels}.
   */
  record(usage: TokenUsage, model: string, sessionKey?: string): void {
    const session = sessionKey ?? DEFAULT_SESSION
    const rate = this.rates[model]

    if (!rate) {
      const seen = this.unratedBySession.get(session)
      if (!seen) {
        this.unratedBySession.set(session, [model])
      } else if (!seen.includes(model)) {
        seen.push(model)
      }
    }

    const inputPerM = rate?.inputPerM ?? 0
    const outputPerM = rate?.outputPerM ?? 0
    const cacheReadPerM = rate?.cacheReadPerM ?? 0
    const cacheWritePerM = rate?.cacheWritePerM ?? 0

    const cost =
      (usage.inputTokens * inputPerM +
        usage.outputTokens * outputPerM +
        (usage.cacheReadTokens ?? 0) * cacheReadPerM +
        (usage.cacheWriteTokens ?? 0) * cacheWritePerM) /
      1_000_000

    this.spentBySession.set(session, (this.spentBySession.get(session) ?? 0) + cost)
  }

  /**
   * Cumulative cost in USD cents for one session.
   * @param sessionKey - Session to read; absent means the default session.
   */
  spentCents(sessionKey?: string): number {
    return this.spentBySession.get(sessionKey ?? DEFAULT_SESSION) ?? 0
  }

  /**
   * Whether a session has reached or exceeded a budget in USD cents.
   *
   * The boundary is exact: a session that has spent exactly the budget is
   * over budget (deterministic refusal at the limit).
   */
  overBudget(budgetCents: number, sessionKey?: string): boolean {
    return this.spentCents(sessionKey) >= budgetCents
  }

  /**
   * Model names recorded for a session with no rate-table entry, distinct
   * and in first-seen order. Absent key means the default session.
   */
  unratedModels(sessionKey?: string): readonly string[] {
    return this.unratedBySession.get(sessionKey ?? DEFAULT_SESSION) ?? []
  }
}

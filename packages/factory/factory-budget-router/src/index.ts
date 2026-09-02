// Fix 2 token budget + Fix 9 routing (ctx.budgetRouter): hard token budget
// enforced by accounting, per-stage model routing with cumulative cost
// conditioning, batch prompting for shared system prompts, cost reported
// alongside pass rate — never mutates request prefixes (golden rule).

import type { BudgetRouterService } from './service.ts'
import type { BudgetRouteDecision, BudgetVetoRecord } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    budgetRouter: BudgetRouterService
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A hard budget veto stopped an `llm/stream` call: the account's spend
     * reached its configured budget, so the call is rejected with
     * `BUDGET_EXCEEDED` before any adapter runs.
     *
     * @mode emit
     * @param record - the veto: account, spend, budget, stage, and timestamp.
     */
    'budget/veto'(record: BudgetVetoRecord): void
    /**
     * An `llm/stream` call settled with its cost-conditioned route decision.
     *
     * @mode emit
     * @param record - the decision: account, stage, cumulative cost, requested
     *   and resolved provider/model, and the route state.
     */
    'budget/route'(record: BudgetRouteDecision): void
  }
}

export { default, BudgetRouterService } from './service.ts'

export type {
  BatchGroup,
  BatchPlan,
  BatchRequest,
  BudgetRouteDecision,
  BudgetRouterConfig,
  BudgetRouteState,
  BudgetVetoRecord,
  CostReport,
  CostReportEntry,
  ModelCost,
  StageRoute,
} from './types.ts'

export { DEEPSEEK_PRO_MODEL_COST, cacheRatio, priceTokens } from './pricing.ts'

export { matchRoute, routeForStage, selectTier } from './routing.ts'

export { estimateSystemTokens, planBatches } from './batch.ts'

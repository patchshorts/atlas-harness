/**
 * Canonical types for `@atlasai/atsh-factory-budget-router`: the budget
 * veto record, the cost-conditioned route decision, the batch grouping plan,
 * and the cost/pass-rate report. Types only — no runtime code.
 * @module @atlasai/atsh-factory-budget-router/types
 */

/** Route resolution vocabulary, identical to the router service's. */
export type BudgetRouteState = 'none' | 'matched' | 'rewritten' | 'advisory'

/** Per-million-token USD pricing for one model. */
export interface ModelCost {
  /** $ per 1M input tokens (cache-miss) */
  input: number
  /** $ per 1M output tokens */
  output: number
  /** $ per 1M cache-read tokens */
  cacheRead: number
  /** $ per 1M cache-write tokens */
  cacheWrite: number
}

/** One tier of a per-stage route ladder. */
export interface StageRoute {
  provider: string
  model: string
  /** This tier applies while cumulative spend <= this; undefined = no upper bound (cheapest last resort) */
  maxCumulativeCost?: number
}

/** Configuration for the {@link BudgetRouterService} service. */
export interface BudgetRouterConfig {
  /** Master switch; when `false` the service is passive (default `true`). */
  enabled?: boolean
  /** Account -> token cap (mirror accounting's budgets). */
  budgets?: Record<string, number>
  /** Stage ('general', ...) -> tier ladder, ascending maxCumulativeCost. */
  stageRoutes?: Record<string, StageRoute[]>
  /** Override pinned deepseek constants. */
  modelCost?: Partial<ModelCost>
  /** Batch prompting for shared system prompts (default `true`). */
  batchPrompting?: boolean
  /** Rewrite non-frozen mismatches (default `true`). */
  applyRoutes?: boolean
}

/** A hard budget veto: an `llm/stream` call stopped at the cap. */
export interface BudgetVetoRecord {
  account: string
  spend: number
  budget: number
  stage: string
  ts: number
}

/** The settled route decision for one `llm/stream` call. */
export interface BudgetRouteDecision {
  account: string
  stage: string
  cumulativeCost: number
  requestedProvider: string
  requestedModel: string
  resolvedProvider: string
  resolvedModel: string
  routeState: BudgetRouteState
}

/** A request considered by batch planning. */
export interface BatchRequest {
  system?: string
  /** Opaque: batch planning never reads message bodies. */
  messages: unknown[]
}

/** One batch group: requests sharing the identical system prompt. */
export interface BatchGroup {
  /** null = requests with no system prompt. */
  system: string | null
  requestIndexes: number[]
  /** Estimated tokens of the shared system prefix. */
  sharedPrefixTokens: number
}

/** The batch grouping plan with the estimated cache-read savings. */
export interface BatchPlan {
  groups: BatchGroup[]
  /** Sum over groups of (size-1) * sharedPrefixTokens. */
  cacheReadSavingsTokens: number
}

/** One entry of the cost report (entries may carry `cachedTokens`/`uncachedTokens` meta). */
export interface CostReportEntry {
  id: string
  costUsd: number
  pass: boolean
}

/** Cost reported alongside pass rate. */
export interface CostReport {
  totalCostUsd: number
  passCount: number
  totalCount: number
  passRate: number
  costPerPassUsd: number
  cachedTokens: number
  uncachedTokens: number
  cacheHitRate: number
}

// BudgetRouterService: the ctx.budgetRouter capability.
//
// Fix 2 token budget + Fix 9 routing: a hard token budget enforced at the
// llm/stream boundary (over-budget calls are vetoed with BUDGET_EXCEEDED),
// per-stage model routing with cumulative-cost conditioning (a tier ladder
// whose tier choice depends on cumulative spend), batch prompting for shared
// system prompts, and cost reported alongside pass rate. Golden rule: the
// service NEVER writes to options.messages or options.system — route
// decisions rewrite only provider/model metadata on non-frozen requests, so
// the request prefix stays byte-identical across stages (prefix-cache-friendly
// history is preserved). The service holds no spend state of its own — the
// ledger is accounting's, read via ctx.get (optional, like the judge).

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { GenerateOptions, StreamChunk } from '@atlasai/atsh-llm'
import { planBatches as computeBatchPlan } from './batch.ts'
import { cacheRatio as computeCacheRatio, DEEPSEEK_PRO_MODEL_COST, priceTokens } from './pricing.ts'
import { matchRoute, routeForStage as selectRouteForStage } from './routing.ts'
import type {
  BatchPlan,
  BatchRequest,
  BudgetRouteDecision,
  BudgetRouterConfig,
  BudgetRouteState,
  CostReport,
  CostReportEntry,
  ModelCost,
  StageRoute,
} from './types.ts'

const SUPPORTED_CONFIG_KEYS = new Set(['enabled', 'budgets', 'stageRoutes', 'modelCost', 'batchPrompting', 'applyRoutes'])

/** Reject stale or misspelled config keys before defaults can hide them. */
function validateConfigKeys(config: BudgetRouterConfig): void {
  for (const key of Object.keys(config)) {
    if (!SUPPORTED_CONFIG_KEYS.has(key)) {
      throw new Error(`BudgetRouterConfig: unknown key "${key}"`)
    }
  }
}

/** Shape of the optional accounting service (loaded via ctx.get, never ctx.accounting). */
interface AccountingLike {
  spendFor(account: string): number
}

/**
 * The Fix 2 + Fix 9 seam: hard token budget enforced by accounting, per-stage
 * model routing with cumulative cost conditioning, batch prompting for shared
 * system prompts, and cost reported alongside pass rate.
 *
 * Golden-rule guarantee: the service holds no model-visible state and never
 * writes to `options.messages`/`options.system` — route decisions rewrite
 * only `provider`/`model` metadata on non-frozen requests, so the request
 * prefix is byte-identical across stages (prefix-cache-friendly history).
 */
export class BudgetRouterService extends Service {
  static Config = z.object({
    enabled: z.boolean().default(true),
    budgets: z.dict(z.number()).default({}),
    stageRoutes: z.dict(z.array(z.object({
      provider: z.string(),
      model: z.string(),
      // Schemastery object properties are optional by nature (ObjectS maps
      // keys with `?`); `maxCumulativeCost` may be omitted for the unbounded
      // last-resort tier.
      maxCumulativeCost: z.number(),
    }))),
    modelCost: z.object({
      input: z.number(),
      output: z.number(),
      cacheRead: z.number(),
      cacheWrite: z.number(),
    }),
    batchPrompting: z.boolean().default(true),
    applyRoutes: z.boolean().default(true),
  })

  private readonly enabled: boolean
  private readonly budgets: Record<string, number>
  private readonly stageRoutes: Record<string, StageRoute[]>
  private readonly modelCost: ModelCost
  private readonly batchPrompting: boolean
  private readonly applyRoutes: boolean

  constructor(ctx: Context, config: BudgetRouterConfig) {
    super(ctx, 'budgetRouter')
    validateConfigKeys(config)
    this.enabled = config.enabled ?? true
    this.budgets = config.budgets ?? {}
    this.stageRoutes = config.stageRoutes ?? {}
    this.modelCost = { ...DEEPSEEK_PRO_MODEL_COST, ...config.modelCost }
    this.batchPrompting = config.batchPrompting ?? true
    this.applyRoutes = config.applyRoutes ?? true
    ctx.effect(() => {
      if (!this.enabled) return () => {}
      // A listener that never calls next() vetoes the rest of the chain —
      // that is the hard budget veto at the llm/stream boundary.
      return this.ctx.on('llm/stream', (options, next) => this.handleStream(options, next))
    }, 'factory-budget-router: llm/stream budget veto + cost-conditioned route listener')
  }

  /**
   * Read the spend/budget/remaining snapshot for one account.
   *
   * Spend comes from accounting's ledger via `ctx.get` (0 when accounting is
   * not mounted); the budget comes from this service's config.
   *
   * @param account - the account id (`options.sessionId ?? 'default'` for llm calls).
   * @returns spend, configured budget (0 when unconfigured), and remaining
   *   (`max(0, budget - spend)`).
   */
  budgetState(account: string): { spend: number; budget: number; remaining: number } {
    const accounting = this.ctx.get('accounting') as AccountingLike | undefined
    const spend = accounting?.spendFor(account) ?? 0
    const budget = this.budgets[account] ?? 0
    return { spend, budget, remaining: Math.max(0, budget - spend) }
  }

  /**
   * Resolve the route for a stage at a cumulative cost.
   *
   * @param stage - the stage key ('general', ...).
   * @param cumulativeCost - cumulative spend for the account/stage.
   * @returns the selected tier, or `undefined` when the stage has no ladder.
   * @throws {Error} When the service is disabled.
   */
  routeForStage(stage: string, cumulativeCost: number): StageRoute | undefined {
    if (!this.enabled) {
      throw new Error('budget-router disabled')
    }
    return selectRouteForStage(stage, cumulativeCost, this.stageRoutes)
  }

  /**
   * Plan batches by grouping requests that share the identical system prompt.
   *
   * @param requests - the requests to group; only `system` is read.
   * @returns the grouping plan plus estimated cache-read savings, or an empty
   *   plan when batch prompting is disabled.
   * @throws {Error} When the service is disabled.
   */
  planBatches(requests: BatchRequest[]): BatchPlan {
    if (!this.enabled) {
      throw new Error('budget-router disabled')
    }
    if (!this.batchPrompting) {
      return { groups: [], cacheReadSavingsTokens: 0 }
    }
    return computeBatchPlan(requests)
  }

  /**
   * Price a usage record with the merged model cost (pinned DeepSeek
   * constants overridden by `config.modelCost`).
   *
   * @param usage - token counts; cache-read/write tokens default 0.
   * @returns USD cost (never negative; 0 on empty usage).
   */
  price(usage: Parameters<typeof priceTokens>[0]): number {
    return priceTokens(usage, this.modelCost)
  }

  /**
   * Report cost alongside pass rate for a batch of entries.
   *
   * Entries may carry `cachedTokens`/`uncachedTokens` meta (accessed via
   * `entry['cachedTokens'] ?? 0` / `entry['uncachedTokens'] ?? 0`), summed
   * into the report for the cache-hit-rate.
   *
   * @param entries - one entry per finished call: id, USD cost, and pass flag.
   * @returns totals, passRate (0 when totalCount is 0), costPerPassUsd (0
   *   when passCount is 0), and the cache-hit rate (0 when no tokens).
   */
  reportCostAndPassRate(entries: CostReportEntry[]): CostReport {
    const totalCount = entries.length
    const passCount = entries.filter(entry => entry.pass).length
    const totalCostUsd = entries.reduce((sum, entry) => sum + entry.costUsd, 0)
    const cachedTokens = entries.reduce((sum, entry) => sum + ((entry as { cachedTokens?: number }).cachedTokens ?? 0), 0)
    const uncachedTokens = entries.reduce((sum, entry) => sum + ((entry as { uncachedTokens?: number }).uncachedTokens ?? 0), 0)
    return {
      totalCostUsd,
      passCount,
      totalCount,
      passRate: totalCount === 0 ? 0 : passCount / totalCount,
      costPerPassUsd: passCount === 0 ? 0 : totalCostUsd / passCount,
      cachedTokens,
      uncachedTokens,
      cacheHitRate: cachedTokens + uncachedTokens === 0 ? 0 : cachedTokens / (cachedTokens + uncachedTokens),
    }
  }

  /**
   * The computed input/cacheRead price gap for the merged model cost.
   *
   * @returns `input / cacheRead` when `cacheRead > 0`, else `NaN`.
   */
  cacheRatio(): number {
    return computeCacheRatio(this.modelCost)
  }

  /**
   * Intercept one `llm/stream` call: veto it when the account is over budget
   * (BUDGET_EXCEEDED, without calling `next()`), otherwise resolve the
   * cost-conditioned route (rewriting only provider/model metadata on
   * non-frozen requests — the request prefix is never touched), wrap the
   * chained stream to count chunks, and emit `budget/route` on settle.
   */
  private handleStream(
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncIterable<StreamChunk> {
    const account = options.sessionId ?? 'default'
    const accounting = this.ctx.get('accounting') as AccountingLike | undefined
    const spend = accounting?.spendFor(account) ?? 0
    const budget = this.budgets[account]

    if (budget !== undefined && spend >= budget) {
      this.ctx.emit('budget/veto', {
        account,
        spend,
        budget,
        stage: options.purpose ?? 'general',
        ts: Date.now(),
      })
      // oxlint-disable-next-line typescript/require-await -- throw-only stream preserves the AsyncIterable contract of the llm/stream chain
      return (async function* vetoed(): AsyncGenerator<StreamChunk> {
        throw Object.assign(new Error(`accounting budget exceeded for account ${account}`), {
          code: 'BUDGET_EXCEEDED',
          name: 'BudgetExceededError',
        })
      })()
    }

    const stage = options.purpose ?? 'general'
    const route = selectRouteForStage(stage, spend, this.stageRoutes)
    const requestedProvider = options.provider
    const requestedModel = options.model
    let resolvedProvider = requestedProvider
    let resolvedModel = requestedModel
    let routeState: BudgetRouteState = 'none'
    if (route !== undefined) {
      const match = matchRoute(requestedProvider, requestedModel, route, Object.isFrozen(options), this.applyRoutes)
      resolvedProvider = match.resolvedProvider
      resolvedModel = match.resolvedModel
      routeState = match.routeState
      if (routeState === 'rewritten') {
        // Golden rule: rewrite ONLY provider/model metadata — never
        // options.messages or options.system (prefix unchanged across stages).
        options.provider = match.resolvedProvider
        options.model = match.resolvedModel
      }
    }

    const decision: BudgetRouteDecision = {
      account,
      stage,
      cumulativeCost: spend,
      requestedProvider,
      requestedModel,
      resolvedProvider,
      resolvedModel,
      routeState,
    }

    // Arrow closure so the wrapped generator's `this` stays the service.
    // oxlint-disable-next-line typescript/no-confusing-void-expression -- intentional void shorthand; braces would hide the emit intent
    const emitRoute = (): void => this.ctx.emit('budget/route', decision)

    return (async function* wrapped(): AsyncGenerator<StreamChunk> {
      let chunkCount = 0
      try {
        const source = next()
        for await (const chunk of source) {
          chunkCount += 1
          yield chunk
        }
      } catch (error) {
        throw error
      } finally {
        emitRoute()
      }
    })()
  }
}

export default BudgetRouterService

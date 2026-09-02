/**
 * Unit coverage for @atlasai/atsh-factory-budget-router: hard token budget
 * enforced by accounting, per-stage model routing with cumulative cost
 * conditioning, batch prompting for shared system prompts, and cost reported
 * alongside pass rate. All tests are deterministic and make zero model calls.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, LlmRuntime, Message, MessageId, StreamChunk } from '@atlasai/atsh-llm'
import AccountingService from '@atlasai/atsh-accounting'
import BudgetRouterService, {
  estimateSystemTokens,
  selectTier,
  type BatchRequest,
  type BudgetRouteDecision,
  type BudgetVetoRecord,
  type CostReportEntry,
  type StageRoute,
} from '../src/index.ts'

/** A fake stream with a 40-input / 60-output usage chunk (100 tokens total). */
async function* chunksWithUsage(): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: 'hello' }
  yield {
    type: 'usage',
    usage: { inputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60 },
  }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** A fake stream with a 40-token usage chunk (under-cap call). */
async function* chunksWithSmallUsage(): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield {
    type: 'usage',
    usage: { inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 30 },
  }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Drain a stream fully, returning the chunks in order. */
async function consume(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

/**
 * Drive one call through the same emission path as `LlmRuntime.stream()`: the
 * waterfall treats the leading object argument as the listener `this` (cast to
 * `LlmRuntime` for the types); the innermost callback is the adapter stream.
 */
function drive(
  ctx: Context,
  options: GenerateOptions,
  inner: () => AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  return ctx.waterfall(ctx as unknown as LlmRuntime, 'llm/stream', options, inner)
}

describe('dsh-factory-budget-router', () => {
  let ctx: Context

  afterEach(async () => {
    await ctx.fiber.dispose()
  })

  it('over-budget run stops at the budget', async () => {
    ctx = new Context()
    const vetoes: BudgetVetoRecord[] = []
    ctx.on('budget/veto', record => vetoes.push(record))
    await ctx.plugin(AccountingService, { credits: 100, budgets: { default: 100 } })
    await ctx.plugin(BudgetRouterService, { budgets: { default: 100 } })
    const options: GenerateOptions = { provider: 'p', model: 'm', messages: [] }
    await consume(drive(ctx, options, chunksWithUsage))
    expect(ctx.accounting.spendFor('default')).toBe(100)
    const innerCalled = { called: false }
    const inner = () => {
      innerCalled.called = true
      return chunksWithUsage()
    }
    await expect(consume(drive(ctx, options, inner))).rejects.toMatchObject({
      code: 'BUDGET_EXCEEDED',
      name: 'BudgetExceededError',
    })
    expect(vetoes).toHaveLength(1)
    expect(vetoes[0]).toMatchObject({ account: 'default', spend: 100, budget: 100 })
    expect(innerCalled.called).toBe(false)
  })

  it('under-budget call passes and is routed', async () => {
    ctx = new Context()
    const vetoes: BudgetVetoRecord[] = []
    ctx.on('budget/veto', record => vetoes.push(record))
    await ctx.plugin(AccountingService, { budgets: { default: 100 } })
    await ctx.plugin(BudgetRouterService, { budgets: { default: 100 } })
    const options: GenerateOptions = { provider: 'p', model: 'm', messages: [] }
    const first = await consume(drive(ctx, options, chunksWithSmallUsage))
    const second = await consume(drive(ctx, options, chunksWithSmallUsage))
    expect(first).toHaveLength(3)
    expect(second).toHaveLength(3)
    expect(ctx.accounting.spendFor('default')).toBe(80)
    expect(vetoes).toHaveLength(0)
  })

  it('routing preserves prefix-cache-friendly history', async () => {
    ctx = new Context()
    const routes: BudgetRouteDecision[] = []
    ctx.on('budget/route', record => routes.push(record))
    await ctx.plugin(BudgetRouterService, {
      stageRoutes: { general: [{ provider: 'p', model: 'pro', maxCumulativeCost: 1000 }] },
    })
    const messages: Message[] = [{
      id: 'm1' as MessageId,
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }]
    const system = 'system prompt'
    const options: GenerateOptions = { provider: 'p', model: 'm', messages, system }
    const messagesBefore = JSON.stringify(options.messages)
    const systemBefore = options.system
    await consume(drive(ctx, options, chunksWithSmallUsage))
    expect(routes).toHaveLength(1)
    expect(routes[0]?.routeState).toBe('rewritten')
    expect(routes[0]?.resolvedProvider).toBe('p')
    expect(routes[0]?.resolvedModel).toBe('pro')
    expect(options.provider).toBe('p')
    expect(options.model).toBe('pro')
    // Golden rule: the request prefix is byte-identical before and after.
    expect(JSON.stringify(options.messages)).toBe(messagesBefore)
    expect(options.system).toBe(systemBefore)
  })

  it('frozen requests degrade to advisory, never mutate', async () => {
    ctx = new Context()
    const routes: BudgetRouteDecision[] = []
    ctx.on('budget/route', record => routes.push(record))
    await ctx.plugin(BudgetRouterService, {
      stageRoutes: { general: [{ provider: 'p', model: 'pro', maxCumulativeCost: 1000 }] },
    })
    const messages = Object.freeze([{ role: 'user', content: 'hello' }])
    const options = Object.freeze({ provider: 'p', model: 'm', messages }) as unknown as GenerateOptions
    await consume(drive(ctx, options, chunksWithSmallUsage))
    expect(routes).toHaveLength(1)
    expect(routes[0]?.routeState).toBe('advisory')
    expect(routes[0]?.resolvedProvider).toBe('p')
    expect(routes[0]?.resolvedModel).toBe('m')
    expect(options.provider).toBe('p')
    expect(options.model).toBe('m')
  })

  it('cumulative cost conditioning switches tiers', async () => {
    ctx = new Context()
    const stageRoutes: Record<string, StageRoute[]> = {
      general: [
        { provider: 'p', model: 'pro', maxCumulativeCost: 50 },
        { provider: 'p', model: 'cheap' },
      ],
    }
    await ctx.plugin(BudgetRouterService, { stageRoutes })
    const ladder = stageRoutes.general!
    // Pure selectTier: the first tier whose bound is undefined OR >=
    // cumulative; once spend exceeds every bound, the cheapest (unbounded)
    // last tier applies. Ladder order corrected by the controller: the
    // brief's test numbers (10 → pro, 60 → cheap) require the premium tier
    // under the bound and the cheap tier as the unbounded last resort.
    expect(selectTier(ladder, 10)?.model).toBe('pro')
    expect(selectTier(ladder, 60)?.model).toBe('cheap')
    // Service routeForStage delegates to the same pure function.
    expect(ctx.budgetRouter.routeForStage('general', 10)?.model).toBe('pro')
    expect(ctx.budgetRouter.routeForStage('general', 60)?.model).toBe('cheap')
  })

  it('batch prompting groups shared system prompts', async () => {
    ctx = new Context()
    await ctx.plugin(BudgetRouterService, {})
    const requests: BatchRequest[] = [
      { system: 'X', messages: [{ role: 'user', content: 'a' }] },
      { system: 'X', messages: [{ role: 'user', content: 'b' }] },
      { messages: [{ role: 'user', content: 'c' }] },
    ]
    const plan = ctx.budgetRouter.planBatches(requests)
    expect(plan.groups).toHaveLength(2)
    const shared = plan.groups.find(group => group.system === 'X')
    const bare = plan.groups.find(group => group.system === null)
    expect(shared?.requestIndexes).toEqual([0, 1])
    expect(shared?.sharedPrefixTokens).toBeGreaterThan(0)
    expect(bare?.requestIndexes).toEqual([2])
    expect(plan.cacheReadSavingsTokens).toBe(estimateSystemTokens('X'))
    const disabled = new Context()
    await disabled.plugin(BudgetRouterService, { batchPrompting: false })
    expect(disabled.budgetRouter.planBatches(requests)).toEqual({ groups: [], cacheReadSavingsTokens: 0 })
    await disabled.fiber.dispose()
  })

  it('cost reported alongside pass rate', async () => {
    ctx = new Context()
    await ctx.plugin(BudgetRouterService, {})
    const entries = [
      { id: 'a', costUsd: 0.435, pass: true, cachedTokens: 100, uncachedTokens: 1_000_000 },
      { id: 'b', costUsd: 0.1, pass: false, cachedTokens: 0, uncachedTokens: 0 },
    ] as unknown as CostReportEntry[]
    const report = ctx.budgetRouter.reportCostAndPassRate(entries)
    expect(report.passCount).toBe(1)
    expect(report.totalCount).toBe(2)
    expect(report.passRate).toBe(0.5)
    expect(report.totalCostUsd).toBeCloseTo(0.535)
    expect(report.costPerPassUsd).toBeCloseTo(0.535)
    expect(report.cachedTokens).toBe(100)
    expect(report.uncachedTokens).toBe(1_000_000)
    expect(report.cacheHitRate).toBeCloseTo(100 / 1_000_100)
    expect(ctx.budgetRouter.cacheRatio()).toBeCloseTo(0.435 / 0.0033)
    expect(ctx.budgetRouter.price({ inputTokens: 1_000_000, outputTokens: 0 })).toBe(0.435)
  })

  it('prices output and cache-write at the real deepseek-v4-flash rate card', async () => {
    // T10: output + cacheWrite were the only zero constants (RECON F2). They
    // are now pinned from the live deepseek-v4-flash/OpenRouter card
    // (2026-08-23): output $0.09772/M, cache-write $0.04886/M (= prompt rate;
    // DeepSeek bills cache writes at the input price). A known 1M-token
    // usage prices to the card number, not zero.
    ctx = new Context()
    await ctx.plugin(BudgetRouterService, {})
    expect(ctx.budgetRouter.price({ inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }))
      .toBeCloseTo(0.09772)
    expect(ctx.budgetRouter.price({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 }))
      .toBeCloseTo(0.04886)
    // Both must be non-zero after the fill (the pre-fix constants were 0).
    const priced = ctx.budgetRouter.price({ inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 1 })
    expect(priced).toBeGreaterThan(0)
  })

  it('disabled config is passive', async () => {
    ctx = new Context()
    const vetoes: BudgetVetoRecord[] = []
    const routes: BudgetRouteDecision[] = []
    ctx.on('budget/veto', record => vetoes.push(record))
    ctx.on('budget/route', record => routes.push(record))
    await ctx.plugin(AccountingService, { budgets: { default: 100 } })
    await ctx.plugin(BudgetRouterService, {
      enabled: false,
      budgets: { default: 100 },
      stageRoutes: { general: [{ provider: 'p', model: 'pro', maxCumulativeCost: 1000 }] },
    })
    const options: GenerateOptions = { provider: 'p', model: 'm', messages: [] }
    const chunks = await consume(drive(ctx, options, chunksWithUsage))
    expect(chunks).toHaveLength(4)
    expect(vetoes).toHaveLength(0)
    expect(routes).toHaveLength(0)
    expect(options.provider).toBe('p')
    expect(options.model).toBe('m')
    expect(() => ctx.budgetRouter.planBatches([{ messages: [] }])).toThrow('budget-router disabled')
    expect(() => ctx.budgetRouter.routeForStage('general', 0)).toThrow('budget-router disabled')
  })

  it('no accounting mounted → passive budget', async () => {
    ctx = new Context()
    const vetoes: BudgetVetoRecord[] = []
    ctx.on('budget/veto', record => vetoes.push(record))
    await ctx.plugin(BudgetRouterService, { budgets: { default: 100 } })
    expect(ctx.budgetRouter.budgetState('default')).toEqual({ spend: 0, budget: 100, remaining: 100 })
    const options: GenerateOptions = { provider: 'p', model: 'm', messages: [] }
    const chunks = await consume(drive(ctx, options, chunksWithUsage))
    expect(chunks).toHaveLength(4)
    expect(vetoes).toHaveLength(0)
  })
})

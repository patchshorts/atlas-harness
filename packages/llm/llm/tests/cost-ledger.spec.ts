import { describe, expect, it } from 'vitest'
import { CostLedger, DEFAULT_SESSION } from '../src/cost/ledger.ts'
import type { ModelRateTable } from '../src/cost/rates.ts'
import type { TokenUsage } from '../src/types.ts'

const usage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  ...overrides,
})

const table = (rates: ModelRateTable = {}): ModelRateTable => rates

describe('CostLedger', () => {
  it('defaults to an empty rate table (nothing is priced)', () => {
    const ledger = new CostLedger()

    ledger.record(usage({ inputTokens: 100, outputTokens: 200 }), 'deepseek-v4-flash')

    expect(ledger.spentCents()).toBe(0)
    expect(ledger.unratedModels()).toEqual(['deepseek-v4-flash'])
  })

  it('records input and output token cost in USD cents', () => {
    const ledger = new CostLedger(
      table({ 'deepseek-v4-flash': { inputPerM: 1000, outputPerM: 2000 } }),
    )

    ledger.record(usage({ inputTokens: 100, outputTokens: 200 }), 'deepseek-v4-flash')

    expect(ledger.spentCents()).toBeCloseTo(0.5)
  })

  it('charges cache reads and writes when the rate has cache prices', () => {
    const ledger = new CostLedger(
      table({
        'deepseek-v4-flash': {
          inputPerM: 1000,
          outputPerM: 2000,
          cacheReadPerM: 100,
          cacheWritePerM: 500,
        },
      }),
    )

    ledger.record(
      usage({
        inputTokens: 100,
        outputTokens: 200,
        cacheReadTokens: 300,
        cacheWriteTokens: 400,
      }),
      'deepseek-v4-flash',
    )

    expect(ledger.spentCents()).toBeCloseTo(0.73)
  })

  it('treats absent cache prices and cache tokens as zero', () => {
    const ledger = new CostLedger(
      table({ 'deepseek-v4-flash': { inputPerM: 1000, outputPerM: 1000 } }),
    )

    ledger.record(
      usage({
        inputTokens: 10,
        outputTokens: 10,
        cacheReadTokens: 100,
        cacheWriteTokens: 200,
      }),
      'deepseek-v4-flash',
    )

    expect(ledger.spentCents()).toBeCloseTo(0.02)
  })

  it('accumulates multiple records into one session', () => {
    const ledger = new CostLedger(
      table({ 'deepseek-v4-flash': { inputPerM: 1000, outputPerM: 1000 } }),
    )

    ledger.record(usage({ inputTokens: 10, outputTokens: 10 }), 'deepseek-v4-flash')
    ledger.record(usage({ inputTokens: 20, outputTokens: 20 }), 'deepseek-v4-flash')

    expect(ledger.spentCents()).toBeCloseTo(0.06)
  })

  it('keeps sessions independent', () => {
    const ledger = new CostLedger(
      table({ 'deepseek-v4-flash': { inputPerM: 1000, outputPerM: 1000 } }),
    )

    ledger.record(usage({ inputTokens: 10, outputTokens: 10 }), 'deepseek-v4-flash', 'session-a')
    ledger.record(usage({ inputTokens: 30, outputTokens: 30 }), 'deepseek-v4-flash', 'session-b')

    expect(ledger.spentCents('session-a')).toBeCloseTo(0.02)
    expect(ledger.spentCents('session-b')).toBeCloseTo(0.06)
  })

  it('treats an omitted session key as the default session', () => {
    const ledger = new CostLedger(
      table({ 'deepseek-v4-flash': { inputPerM: 1000, outputPerM: 1000 } }),
    )

    ledger.record(usage({ inputTokens: 10, outputTokens: 10 }), 'deepseek-v4-flash')
    ledger.record(usage({ inputTokens: 10, outputTokens: 10 }), 'deepseek-v4-flash', DEFAULT_SESSION)

    expect(ledger.spentCents()).toBeCloseTo(0.04)
    expect(ledger.spentCents(DEFAULT_SESSION)).toBeCloseTo(0.04)
  })

  it('flags unrated models and charges zero for them', () => {
    const ledger = new CostLedger(
      table({ 'deepseek-v4': { inputPerM: 300, outputPerM: 600 } }),
    )

    ledger.record(usage({ inputTokens: 10, outputTokens: 10 }), 'unrated-model')
    ledger.record(usage({ inputTokens: 10, outputTokens: 10 }), 'deepseek-v4')

    expect(ledger.spentCents()).toBeCloseTo(0.009)
    expect(ledger.unratedModels()).toEqual(['unrated-model'])
  })

  it('keeps unrated models distinct and in first-seen order', () => {
    const ledger = new CostLedger()

    ledger.record(usage({ inputTokens: 5 }), 'model-x')
    ledger.record(usage({ inputTokens: 5 }), 'model-y')
    ledger.record(usage({ inputTokens: 5 }), 'model-x')

    expect(ledger.unratedModels()).toEqual(['model-x', 'model-y'])
  })

  it('reports no unrated models for a session that only used rated models', () => {
    const ledger = new CostLedger(
      table({ 'deepseek-v4-flash': { inputPerM: 1000, outputPerM: 1000 } }),
    )

    ledger.record(usage({ inputTokens: 1 }), 'deepseek-v4-flash', 'session-a')
    ledger.record(usage({ inputTokens: 1 }), 'deepseek-v4-flash', 'session-b')

    expect(ledger.unratedModels('session-a')).toEqual([])
    expect(ledger.unratedModels('session-b')).toEqual([])
  })

  it('is over budget when spending exactly the budget (exact-limit refusal)', () => {
    const ledger = new CostLedger(
      table({ 'deepseek-v4-flash': { inputPerM: 1000, outputPerM: 1000 } }),
    )

    ledger.record(usage({ inputTokens: 10, outputTokens: 10 }), 'deepseek-v4-flash')

    expect(ledger.spentCents()).toBeCloseTo(0.02)
    expect(ledger.overBudget(0.02)).toBe(true)
  })

  it('is not over budget below the limit', () => {
    const ledger = new CostLedger(
      table({ 'deepseek-v4-flash': { inputPerM: 1000, outputPerM: 1000 } }),
    )

    ledger.record(usage({ inputTokens: 10, outputTokens: 10 }), 'deepseek-v4-flash')

    expect(ledger.overBudget(0.03)).toBe(false)
  })

  it('judges overBudget per session and treats an unspent session as zero', () => {
    const ledger = new CostLedger(
      table({ 'deepseek-v4-flash': { inputPerM: 1000, outputPerM: 1000 } }),
    )

    ledger.record(usage({ inputTokens: 10, outputTokens: 10 }), 'deepseek-v4-flash', 'session-a')

    expect(ledger.overBudget(0.02, 'session-a')).toBe(true)
    expect(ledger.overBudget(0.02, 'session-b')).toBe(false)
    expect(ledger.overBudget(0, 'session-b')).toBe(true)
  })
})

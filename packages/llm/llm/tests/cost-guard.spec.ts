import { describe, expect, it } from 'vitest'
import { HarnessError } from '../src/error.ts'
import { LlmError } from '../src/error.ts'
import { BUDGET_EXCEEDED_CODE, createBudgetGuard, LlmBudgetError } from '../src/cost/guard.ts'
import { CostLedger } from '../src/cost/ledger.ts'
import type { ModelRateTable } from '../src/cost/rates.ts'
import type { TokenUsage } from '../src/types.ts'

const usage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  ...overrides,
})

const table = (rates: ModelRateTable = {}): ModelRateTable => rates

const FLASH = 'deepseek-v4-flash'

const pricedLedger = (): CostLedger => {
  const ledger = new CostLedger(table({ [FLASH]: { inputPerM: 1000, outputPerM: 1000 } }))
  ledger.record(usage({ inputTokens: 10, outputTokens: 10 }), FLASH) // 0.02 cents
  return ledger
}

describe('createBudgetGuard', () => {
  it('allows a call below the budget', () => {
    const guard = createBudgetGuard(pricedLedger(), 0.03)

    expect(guard.check(FLASH)).toEqual({ allowed: true, model: FLASH })
  })

  it('refuses at the exact budget limit (deterministic boundary)', () => {
    const guard = createBudgetGuard(pricedLedger(), 0.02)

    expect(guard.check(FLASH)).toEqual({ allowed: false, reason: BUDGET_EXCEEDED_CODE, model: FLASH })
  })

  it('refuses when the session has spent more than the budget', () => {
    const guard = createBudgetGuard(pricedLedger(), 0.01)

    expect(guard.check(FLASH)).toEqual({ allowed: false, reason: BUDGET_EXCEEDED_CODE, model: FLASH })
  })

  it('judges each session independently', () => {
    const ledger = new CostLedger(table({ [FLASH]: { inputPerM: 1000, outputPerM: 1000 } }))
    ledger.record(usage({ inputTokens: 10, outputTokens: 10 }), FLASH, 'session-a') // 0.02
    const guard = createBudgetGuard(ledger, 0.02)

    expect(guard.check(FLASH, 'session-a').allowed).toBe(false)
    expect(guard.check(FLASH, 'session-b').allowed).toBe(true)
  })

  it('treats an omitted session key as the default session', () => {
    const guard = createBudgetGuard(pricedLedger(), 0.02)

    expect(guard.check(FLASH, 'default').allowed).toBe(false)
  })

  it('refuses an unspent session against a zero budget', () => {
    const guard = createBudgetGuard(new CostLedger(), 0)

    expect(guard.check(FLASH).allowed).toBe(false)
  })
})

describe('LlmBudgetError', () => {
  it('extends LlmError and HarnessError with the stable budget code', () => {
    const err = new LlmBudgetError('session budget exceeded')

    expect(err).toBeInstanceOf(LlmBudgetError)
    expect(err).toBeInstanceOf(LlmError)
    expect(err).toBeInstanceOf(HarnessError)
    expect(err.name).toBe('LlmBudgetError')
    expect(err.code).toBe(BUDGET_EXCEEDED_CODE)
    expect(err.message).toBe('session budget exceeded')
  })

  it('freezes the serializable failure facts', () => {
    const err = new LlmBudgetError('session budget exceeded')

    expect(Object.isFrozen(err.failure)).toBe(true)
    expect(err.failure).toEqual({ message: 'session budget exceeded', code: BUDGET_EXCEEDED_CODE })
  })

  it('accepts a cause via error options', () => {
    const cause = new Error('provider reported account exhausted')
    const err = new LlmBudgetError('session budget exceeded', { cause })

    expect(err.cause).toBe(cause)
    expect(err.failure.code).toBe(BUDGET_EXCEEDED_CODE)
  })

  it('enforces the LlmError message and code invariants', () => {
    expect(() => new LlmBudgetError('')).toThrow(/message/)
  })
})

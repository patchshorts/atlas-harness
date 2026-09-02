import { describe, expect, it } from 'vitest'
import { type ModelCapabilityTable } from '../src/cost/capability.ts'
import { type ModelRateTable } from '../src/cost/rates.ts'
import { cascadeRoutes, resolveRoute } from '../src/routing.ts'

describe('resolveRoute', () => {
  it('defaults to the cheap model when no signal is given', () => {
    expect(
      resolveRoute({ cheap: 'deepseek-v4-flash', expensive: 'deepseek-v4' }),
    ).toBe('deepseek-v4-flash')
  })

  it('keeps the cheap model on a certain signal', () => {
    expect(
      resolveRoute({
        cheap: 'deepseek-v4-flash',
        expensive: 'deepseek-v4',
        signal: 'certain',
      }),
    ).toBe('deepseek-v4-flash')
  })

  it('escalates to the expensive model on an uncertain signal', () => {
    expect(
      resolveRoute({
        cheap: 'deepseek-v4-flash',
        expensive: 'deepseek-v4',
        signal: 'uncertain',
      }),
    ).toBe('deepseek-v4')
  })
})

describe('cascadeRoutes', () => {
  it('keeps the cheapest route when no signal is given', () => {
    expect(cascadeRoutes(['deepseek-v4-flash', 'deepseek-v4'])).toBe(
      'deepseek-v4-flash',
    )
  })

  it('keeps the cheapest route on a certain signal', () => {
    expect(cascadeRoutes(['deepseek-v4-flash', 'deepseek-v4'], 'certain')).toBe(
      'deepseek-v4-flash',
    )
  })

  it('escalates one step on an uncertain signal', () => {
    expect(cascadeRoutes(['deepseek-v4-flash', 'deepseek-v4'], 'uncertain')).toBe(
      'deepseek-v4',
    )
  })

  it('escalates only one step on a longer chain', () => {
    expect(
      cascadeRoutes(
        ['deepseek-v4-flash', 'deepseek-v4-lite', 'deepseek-v4'],
        'uncertain',
      ),
    ).toBe('deepseek-v4-lite')
  })

  it('stays at the last route when already at the ceiling', () => {
    expect(cascadeRoutes(['deepseek-v4'], 'uncertain')).toBe('deepseek-v4')
  })

  it('returns an empty string for an empty chain', () => {
    expect(cascadeRoutes([])).toBe('')
    expect(cascadeRoutes([], 'uncertain')).toBe('')
  })
})

const CODE_CAPABILITIES: ModelCapabilityTable = {
  'deepseek-v4-flash': {
    domains: { code: { humanEval: 82 } },
    contextWindow: 128000,
    reasoningTier: 2,
  },
  'deepseek-v4-lite': {
    domains: { code: { humanEval: 92 } },
    contextWindow: 128000,
    reasoningTier: 3,
  },
  'deepseek-v4': {
    domains: { code: { sweBench: 72, humanEval: 95 } },
    contextWindow: 128000,
    reasoningTier: 4,
  },
}

const CODE_RATES: ModelRateTable = {
  'deepseek-v4-flash': { inputPerM: 10, outputPerM: 20 },
  'deepseek-v4-lite': { inputPerM: 15, outputPerM: 30 },
  'deepseek-v4': { inputPerM: 20, outputPerM: 40 },
}

describe('resolveRoute capability form', () => {
  it('picks the cheapest eligible model on a certain signal', () => {
    expect(
      resolveRoute({
        candidates: ['deepseek-v4-flash', 'deepseek-v4-lite', 'deepseek-v4'],
        domain: 'code',
        signal: 'certain',
        registry: CODE_CAPABILITIES,
        rates: CODE_RATES,
      }),
    ).toBe('deepseek-v4-flash')
  })

  it('keeps the cheapest eligible model when the signal is absent', () => {
    expect(
      resolveRoute({
        candidates: ['deepseek-v4-flash', 'deepseek-v4-lite', 'deepseek-v4'],
        domain: 'code',
        registry: CODE_CAPABILITIES,
        rates: CODE_RATES,
      }),
    ).toBe('deepseek-v4-flash')
  })

  it('escalates one step up the eligible chain on an uncertain signal', () => {
    expect(
      resolveRoute({
        candidates: ['deepseek-v4-flash', 'deepseek-v4-lite', 'deepseek-v4'],
        domain: 'code',
        signal: 'uncertain',
        registry: CODE_CAPABILITIES,
        rates: CODE_RATES,
      }),
    ).toBe('deepseek-v4-lite')
  })

  it('stays on the cheapest eligible model when the chain has one entry', () => {
    expect(
      resolveRoute({
        candidates: ['deepseek-v4'],
        domain: 'code',
        signal: 'uncertain',
        registry: CODE_CAPABILITIES,
        rates: CODE_RATES,
      }),
    ).toBe('deepseek-v4')
  })

  it('skips an unknown candidate and falls through to an eligible one', () => {
    expect(
      resolveRoute({
        candidates: ['ghost-model', 'deepseek-v4-flash', 'deepseek-v4-lite'],
        domain: 'code',
        signal: 'certain',
        registry: CODE_CAPABILITIES,
        rates: CODE_RATES,
      }),
    ).toBe('deepseek-v4-flash')
  })

  it('skips an unrated candidate and falls through to an eligible one', () => {
    const registry: ModelCapabilityTable = {
      ...CODE_CAPABILITIES,
      'unrated-model': {
        domains: { code: { humanEval: 99 } },
        contextWindow: 128000,
        reasoningTier: 4,
      },
    }
    expect(
      resolveRoute({
        candidates: ['unrated-model', 'deepseek-v4-flash'],
        domain: 'code',
        registry,
        rates: CODE_RATES,
      }),
    ).toBe('deepseek-v4-flash')
  })

  it('degrades to the full candidate cascade when nothing is eligible', () => {
    // Neither candidate is capable of math, so the eligible chain is empty
    // and routing falls back to a cascade over the full candidate list.
    expect(
      resolveRoute({
        candidates: ['deepseek-v4-flash', 'deepseek-v4-lite'],
        domain: 'math',
        signal: 'certain',
        registry: CODE_CAPABILITIES,
        rates: CODE_RATES,
      }),
    ).toBe('deepseek-v4-flash')
    expect(
      resolveRoute({
        candidates: ['deepseek-v4-flash', 'deepseek-v4-lite'],
        domain: 'math',
        signal: 'uncertain',
        registry: CODE_CAPABILITIES,
        rates: CODE_RATES,
      }),
    ).toBe('deepseek-v4-lite')
  })

  it('returns an empty string for empty candidates', () => {
    expect(
      resolveRoute({
        candidates: [],
        domain: 'code',
        registry: CODE_CAPABILITIES,
        rates: CODE_RATES,
      }),
    ).toBe('')
  })

  it('does not crash on an empty registry with non-empty candidates', () => {
    expect(
      resolveRoute({
        candidates: ['deepseek-v4-flash'],
        domain: 'code',
        signal: 'certain',
        registry: {},
        rates: CODE_RATES,
      }),
    ).toBe('deepseek-v4-flash')
  })

  it('does not crash on an empty registry for the simple domain', () => {
    expect(
      resolveRoute({
        candidates: ['deepseek-v4-flash', 'deepseek-v4-lite'],
        domain: 'simple',
        signal: 'uncertain',
        registry: {},
        rates: CODE_RATES,
      }),
    ).toBe('deepseek-v4-lite')
  })

  it('routes the simple domain without a capability gate', () => {
    expect(
      resolveRoute({
        candidates: ['deepseek-v4-flash', 'deepseek-v4-lite'],
        domain: 'simple',
        signal: 'certain',
        registry: CODE_CAPABILITIES,
        rates: CODE_RATES,
      }),
    ).toBe('deepseek-v4-flash')
  })

  it('routes capable candidates on the reasoning domain', () => {
    // deepseek-v4-flash (tier 2) is not reasoning-capable and is excluded;
    // deepseek-v4 (tier 4) is reasoning-capable by tier and remains the
    // sole eligible entry.
    expect(
      resolveRoute({
        candidates: ['deepseek-v4-flash', 'deepseek-v4'],
        domain: 'reasoning',
        signal: 'certain',
        registry: CODE_CAPABILITIES,
        rates: CODE_RATES,
      }),
    ).toBe('deepseek-v4')
  })
})

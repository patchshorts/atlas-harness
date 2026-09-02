import { describe, expect, it } from 'vitest'
import { type ModelCapabilityTable } from '../src/cost/capability.ts'
import { type ModelRateTable } from '../src/cost/rates.ts'
import { classify } from '../src/routing/domain.ts'
import { cheapestCapable } from '../src/routing/selector.ts'
import { resolveRoute } from '../src/routing.ts'

// Deterministic fake embedder — no live LLM. Each domain axis of the first 4
// embedding dims maps to a distinctive keyword. The trailing fallthrough has
// all axis coordinates 0, so its cosine against every prototype is 0 —
// below LOW_CONFIDENCE_THRESHOLD (0.35) — and it collapses to 'reasoning'.
const embed = (text: string): number[] => {
  const clamp1 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
  if (text.includes('function')) return [1, 0, 0, 0] // code
  if (text.includes('equation')) return [0, 1, 0, 0] // math
  if (text.includes('history')) return [0, 0, 1, 0] // knowledge
  if (text.includes('reason')) return [0, 0, 0, 1] // reasoning
  return [clamp1(0), 0, 0, clamp1(0)] // zero vector -> cosine 0 -> 'reasoning'
}

// Broader domain registry — price distinct per model so the cheapest-capable
// winner is unambiguous in each domain. Note the capability table schema uses
// `contextWindow` and `reasoningTier`.
const REG: ModelCapabilityTable = {
  'code-flash': { domains: { code: { humanEval: 98 } }, contextWindow: 128000, reasoningTier: 2 },
  'code-pro': {
    domains: { code: { sweBench: 72, humanEval: 95 } },
    contextWindow: 128000,
    reasoningTier: 4,
  },
  'math-flash': { domains: { math: { aime: 88 } }, contextWindow: 128000, reasoningTier: 2 },
  'math-pro': { domains: { math: { gpqa: 96 } }, contextWindow: 128000, reasoningTier: 4 },
  'know-flash': { domains: { knowledge: { mmlu: 98 } }, contextWindow: 128000, reasoningTier: 2 },
  'know-pro': { domains: { knowledge: { mmlu: 99 } }, contextWindow: 128000, reasoningTier: 4 },
  'rea-t2': { domains: { reasoning: { arcAgi2: 50 } }, contextWindow: 128000, reasoningTier: 2 },
  'rea-pro': { domains: {}, contextWindow: 128000, reasoningTier: 4 },
}

const RATES: ModelRateTable = {
  'code-flash': { inputPerM: 10, outputPerM: 20 },
  'code-pro': { inputPerM: 20, outputPerM: 40 },
  'math-flash': { inputPerM: 12, outputPerM: 24 },
  'math-pro': { inputPerM: 25, outputPerM: 50 },
  'know-flash': { inputPerM: 8, outputPerM: 16 },
  'know-pro': { inputPerM: 30, outputPerM: 60 },
  'rea-t2': { inputPerM: 18, outputPerM: 36 },
  'rea-pro': { inputPerM: 40, outputPerM: 80 },
}

describe('capability routing integration across domains', () => {
  it('routes a code prompt to the cheapest code-capable model', () => {
    expect(classify('write a function that sorts', embed)).toEqual({
      domain: 'code',
      confidence: 1,
    })
    // Candidates are cheapest first, per the resolveRoute contract.
    expect(
      resolveRoute({
        candidates: ['code-flash', 'code-pro'],
        domain: 'code',
        registry: REG,
        rates: RATES,
      }),
    ).toBe('code-flash') // 10 < 20
  })

  it('routes a math prompt to the cheapest math-capable model', () => {
    expect(classify('solve this equation', embed)).toEqual({
      domain: 'math',
      confidence: 1,
    })
    expect(
      resolveRoute({
        candidates: ['math-flash', 'math-pro'],
        domain: 'math',
        registry: REG,
        rates: RATES,
      }),
    ).toBe('math-flash')
  })

  it('routes a knowledge prompt to the cheapest knowledge-capable model', () => {
    expect(classify('list the facts for history', embed)).toEqual({
      domain: 'knowledge',
      confidence: 1,
    })
    expect(
      resolveRoute({
        candidates: ['know-flash', 'know-pro'],
        domain: 'knowledge',
        registry: REG,
        rates: RATES,
      }),
    ).toBe('know-flash')
  })

  it('routes a reasoning prompt to the cheapest reasoning capable model', () => {
    expect(classify('reason about this hypothesis', embed)).toEqual({
      domain: 'reasoning',
      confidence: 1,
    })
    expect(
      resolveRoute({
        candidates: ['rea-t2', 'rea-pro'],
        domain: 'reasoning',
        registry: REG,
        rates: RATES,
      }),
    ).toBe('rea-t2') // rea-t2 (18) < rea-pro (40)
  })

  it('escalates one step up the eligible chain when the signal is uncertain', () => {
    // Candidates are cheapest-first; uncertain escalates to the SECOND eligible
    // code-capable model (candidate order, not price order).
    expect(
      resolveRoute({
        candidates: ['code-flash', 'code-pro'],
        domain: 'code',
        signal: 'uncertain',
        registry: REG,
        rates: RATES,
      }),
    ).toBe('code-pro')
  })

  it('falls back past an unrated capable model to the rated eligible model', () => {
    const reg2: ModelCapabilityTable = {
      ...REG,
      'unrated-code': {
        domains: { code: { humanEval: 70 } },
        contextWindow: 128000,
        reasoningTier: 2,
      },
    }
    expect(
      resolveRoute({
        candidates: ['unrated-code', 'code-flash'],
        domain: 'code',
        signal: 'certain',
        registry: reg2,
        rates: RATES,
      }),
    ).toBe('code-flash')
  })

  it('flags the unrated skip reason from cheapestCapable', () => {
    const reg2: ModelCapabilityTable = {
      ...REG,
      'unrated-code': {
        domains: { code: { humanEval: 70 } },
        contextWindow: 128000,
        reasoningTier: 2,
      },
    }
    expect(cheapestCapable(['unrated-code', 'code-flash'], 'code', reg2, RATES)).toEqual({
      model: 'code-flash',
      skipped: [{ model: 'unrated-code', reason: 'unrated' }],
    })
  })

  it('is a pure function of (prompt, embed) — repeated classify is deterministic', () => {
    const a = classify('write a function that sorts', embed)
    const b = classify('write a function that sorts', embed)
    expect(b).toEqual(a)
  })

  it('routes a low-confidence prompt to the reasoning fallback tier', () => {
    const r = classify('a vague prompt with no domain marker', embed)
    expect(r.domain).toBe('reasoning')
    expect(r.confidence).toBeLessThan(0.35)
  })
})

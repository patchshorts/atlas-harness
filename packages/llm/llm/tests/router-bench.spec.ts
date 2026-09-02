import { describe, expect, it } from 'vitest'
import { isCapable, type ModelCapabilityTable } from '../src/cost/capability.ts'
import { type ModelRateTable } from '../src/cost/rates.ts'
import { classify } from '../src/routing/domain.ts'
import { resolveRoute, type CertaintySignal } from '../src/routing.ts'

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

// Model registry — price distinct per model so the cheapest-capable winner is
// unambiguous in each domain. `rea-pro` deliberately has an empty `domains`
// bag and wins reasoning only via reasoningTier 4.
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

// The full candidate set a realistic caller allows, cheapest first.
const CANDIDATES = [
  'know-flash',
  'code-flash',
  'math-flash',
  'rea-t2',
  'code-pro',
  'math-pro',
  'know-pro',
  'rea-pro',
] as const

// The cheap tier of the candidate set — the easier-to-satisfy models the
// cascade should default to whenever the certainty signal is calm.
const CHEAP_TIER = new Set(['know-flash', 'code-flash', 'math-flash', 'rea-t2'])

/**
 * Mini RouterBench harness helper: classify a prompt, then route it through
 * the capability-aware overload against the full candidate set.
 */
const route = (prompt: string, signal?: CertaintySignal): string => {
  const { domain } = classify(prompt, embed)
  return resolveRoute({
    candidates: CANDIDATES,
    domain,
    // exactOptionalPropertyTypes: omit the key instead of passing `undefined`.
    ...(signal === undefined ? {} : { signal }),
    registry: REG,
    rates: RATES,
  })
}

describe('mini RouterBench — deterministic route distribution', () => {
  it('routes a majority of the sample set to the cheap tier on a calm signal', () => {
    // MMLU-style, GSM8K-style, code, and MT-Bench-style reasoning samples all
    // resolve to their domain's cheapest capable model when certain/absent.
    const samples: ReadonlyArray<{ readonly prompt: string; readonly signal?: CertaintySignal }> = [
      { prompt: 'which of these history facts is true' }, // knowledge
      { prompt: 'what is the main history event here' }, // knowledge
      { prompt: 'name a well-known history figure' }, // knowledge
      { prompt: 'solve this equation step by step' }, // math
      { prompt: 'compute the equation result' }, // math
      { prompt: 'find x in this equation' }, // math
      { prompt: 'write a function that parses this' }, // code
      { prompt: 'refactor a function for clarity' }, // code
      { prompt: 'reason about the trade-offs' }, // reasoning -> rea-t2
      { prompt: 'analyze and reason through this argument' }, // reasoning -> rea-t2
      // Two escalated samples intentionally fall OUT of the cheap tier.
      { prompt: 'reason carefully with high stakes', signal: 'uncertain' }, // -> rea-pro
      { prompt: 'final reasoning pass for correctness', signal: 'uncertain' }, // -> rea-pro
    ]
    const cheapCount = samples.filter(s => CHEAP_TIER.has(route(s.prompt, s.signal))).length
    expect(cheapCount / samples.length).toBeGreaterThanOrEqual(0.6)
  })

  it('reports the expected cheap-tier winners for the calm samples', () => {
    expect(route('which of these history facts is true')).toBe('know-flash')
    expect(route('solve this equation step by step')).toBe('math-flash')
    expect(route('write a function that parses this')).toBe('code-flash')
  })

  it('quality guard: an uncertain reasoning sample never collapses to the cheap baseline', () => {
    // On a reasoning-scoped ladder, uncertainty escalates rea-t2 -> rea-pro.
    const escalated = resolveRoute({
      candidates: ['rea-t2', 'rea-pro'],
      domain: 'reasoning',
      signal: 'uncertain',
      registry: REG,
      rates: RATES,
    })
    expect(escalated).toBe('rea-pro')
    // Against the FULL candidate set, the tier-4 pro models are also
    // reasoning-capable, so one-step escalation lands on code-pro — the
    // point is that it ALWAYS escapes the cheap-only reasoning baseline.
    const fullEscape = route('reason carefully with high stakes', 'uncertain')
    expect(CHEAP_TIER.has(fullEscape)).toBe(false)
  })

  it('is deterministic — the same prompt routes the same way every time', () => {
    const a = route('solve this equation step by step')
    const b = route('solve this equation step by step')
    expect(b).toBe(a)
  })

  it('falls back to the reasoning tier on a low-confidence prompt', () => {
    const classified = classify('a vague prompt with no domain marker', embed)
    expect(classified.domain).toBe('reasoning')
    expect(classified.confidence).toBeLessThan(0.35)
    // The fallback still lands on the cheapest reasoning-capable model.
    expect(route('a vague prompt with no domain marker')).toBe('rea-t2')
  })

  it('rea-pro is reasoning-capable via reasoningTier 4 despite an empty domains bag', () => {
    const reaPro = REG['rea-pro']
    expect(reaPro, 'rea-pro must be registered in REG').toBeDefined()
    if (reaPro === undefined) {
      throw new Error('rea-pro missing from REG fixture')
    }
    expect(isCapable(reaPro, 'reasoning')).toBe(true)
  })
})

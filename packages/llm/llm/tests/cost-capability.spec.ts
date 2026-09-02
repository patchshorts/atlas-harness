import { describe, expect, it } from 'vitest'
import {
  emptyCapabilityTable,
  HIGHEST_REASONING_TIER,
  isCapable,
  ModelCapabilitySchema,
  ModelCapabilityTableSchema,
} from '../src/cost/capability.ts'

describe('model capability table', () => {
  it('defaults to an empty table (no fabricated capabilities)', () => {
    expect(emptyCapabilityTable()).toEqual({})
    expect(ModelCapabilityTableSchema(undefined)).toEqual({})
  })

  it('parses a full capability with all benchmark scores, context, and tier', () => {
    expect(
      ModelCapabilitySchema({
        domains: {
          code: { sweBench: 88, humanEval: 84 },
          math: { gpqa: 90, aime: 75 },
          knowledge: { mmlu: 88 },
          reasoning: { arcAgi2: 61 },
        },
        contextWindow: 131_072,
        reasoningTier: 4,
      }),
    ).toEqual({
      domains: {
        code: { sweBench: 88, humanEval: 84 },
        math: { gpqa: 90, aime: 75 },
        knowledge: { mmlu: 88 },
        reasoning: { arcAgi2: 61 },
      },
      contextWindow: 131_072,
      reasoningTier: 4,
    })
  })

  it('defaults absent domains to empty bags (not capable of any domain)', () => {
    const entry = ModelCapabilitySchema({ contextWindow: 4096, reasoningTier: 1 })
    expect(entry.domains).toEqual({ code: {}, math: {}, knowledge: {}, reasoning: {} })
    expect(entry).toEqual({
      domains: { code: {}, math: {}, knowledge: {}, reasoning: {} },
      contextWindow: 4096,
      reasoningTier: 1,
    })
    expect(isCapable(entry, 'code')).toBe(false)
    expect(isCapable(entry, 'reasoning')).toBe(false)
  })

  it('parses a table of multiple models', () => {
    const table = ModelCapabilityTableSchema({
      'deepseek-v4-flash': { contextWindow: 131_072, reasoningTier: 4 },
      'deepseek-v3': {
        domains: { code: { humanEval: 60 } },
        contextWindow: 65_536,
        reasoningTier: 2,
      },
    })

    expect(table['deepseek-v4-flash']?.domains ?? {}).toEqual({
      code: {},
      math: {},
      knowledge: {},
      reasoning: {},
    })
    expect(table['deepseek-v3']?.domains ?? {}).toEqual({
      code: { humanEval: 60 },
      math: {},
      knowledge: {},
      reasoning: {},
    })
  })

  describe('domain capability derivation', () => {
    const capable = ModelCapabilitySchema({
      domains: { code: { humanEval: 60 } },
      contextWindow: 131_072,
      reasoningTier: 3,
    })

    it('marks a domain capable only when it carries a benchmark score', () => {
      expect(isCapable(capable, 'code')).toBe(true)
      expect(isCapable(capable, 'math')).toBe(false)
      expect(isCapable(capable, 'knowledge')).toBe(false)
    })

    it('treats the highest tier as reasoning-capable without a score', () => {
      expect(isCapable(capable, 'reasoning')).toBe(false)
      expect(
        isCapable(
          ModelCapabilitySchema({
            contextWindow: 131_072,
            reasoningTier: HIGHEST_REASONING_TIER,
          }),
          'reasoning',
        ),
      ).toBe(true)
    })

    it('treats an explicit reasoning score as reasoning-capable at any tier', () => {
      expect(
        isCapable(
          ModelCapabilitySchema({
            domains: { reasoning: { arcAgi2: 61 } },
            contextWindow: 131_072,
            reasoningTier: 2,
          }),
          'reasoning',
        ),
      ).toBe(true)
    })
  })

  it.each([
    [
      'a negative benchmark score',
      { contextWindow: 1, reasoningTier: 1, domains: { code: { sweBench: -1 } } },
    ],
    [
      'a benchmark score above 100',
      { contextWindow: 1, reasoningTier: 1, domains: { code: { sweBench: 101 } } },
    ],
    ['a zero context window', { contextWindow: 0, reasoningTier: 1 }],
    ['a negative context window', { contextWindow: -100, reasoningTier: 1 }],
    ['a reasoning tier below 1', { contextWindow: 1000, reasoningTier: 0 }],
    ['a reasoning tier above 4', { contextWindow: 1000, reasoningTier: 5 }],
  ] as const)('rejects %s', (_label, entry) => {
    expect(() => ModelCapabilitySchema(entry as never)).toThrow()
  })

  it('rejects a non-object table entry', () => {
    expect(() => ModelCapabilityTableSchema({ 'deepseek-v4-flash': 42 } as never)).toThrow()
  })
})

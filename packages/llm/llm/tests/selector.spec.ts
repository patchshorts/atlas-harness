import { describe, expect, it } from 'vitest'
import { ModelCapability } from '../src/cost/capability.ts'
import { ModelRate } from '../src/cost/rates.ts'
import { TaskDomain } from '../src/routing/domain.ts'
import { cheapestCapable } from '../src/routing/selector.ts'

// Deterministic fixture tables. Capabilities and rates are configured objects
// (benchmark-configured, never fabricated): the selector reads them through
// their plain maps and fabricates nothing itself.
const codeCapable: ModelCapability = {
  domains: { code: { sweBench: 60 } },
  contextWindow: 131_072,
  reasoningTier: 2,
}
const mathCapable: ModelCapability = {
  domains: { math: { gpqa: 70 } },
  contextWindow: 131_072,
  reasoningTier: 2,
}
const knowledgeCapable: ModelCapability = {
  domains: { knowledge: { mmlu: 75 } },
  contextWindow: 131_072,
  reasoningTier: 2,
}
const reasoningByScore: ModelCapability = {
  domains: { reasoning: { arcAgi2: 55 } },
  contextWindow: 131_072,
  reasoningTier: 2,
}
const reasoningByTier: ModelCapability = {
  domains: {},
  contextWindow: 131_072,
  reasoningTier: 4,
}
// A registered model with no benchmark bags: not capable of any domain.
const notCapable: ModelCapability = {
  domains: {},
  contextWindow: 4096,
  reasoningTier: 1,
}

const cheap: ModelRate = { inputPerM: 10, outputPerM: 20 }
const out20: ModelRate = { inputPerM: 10, outputPerM: 20 }
const out30: ModelRate = { inputPerM: 10, outputPerM: 30 }
const mid: ModelRate = { inputPerM: 20, outputPerM: 30 }
const pricey: ModelRate = { inputPerM: 30, outputPerM: 40 }

describe('cheapestCapable: NULL selection with nothing eligible', () => {
  it('returns { model: null, skipped: [] } for empty candidates', () => {
    expect(cheapestCapable([], 'code', {}, {})).toEqual({ model: null, skipped: [] })
  })

  it('flags every candidate unknown when the registry is empty, for a capable domain', () => {
    expect(cheapestCapable(['a', 'b'], 'code', {}, {})).toEqual({
      model: null,
      skipped: [
        { model: 'a', reason: 'unknown' },
        { model: 'b', reason: 'unknown' },
      ],
    })
  })

  it('flags every candidate unknown when the registry is empty, for the simple domain', () => {
    // plank e1: a simple task with an empty registry returns a NULL selection,
    // never a crash. Every candidate is unknown because nothing is registered.
    expect(cheapestCapable(['a'], 'simple', {}, {})).toEqual({
      model: null,
      skipped: [{ model: 'a', reason: 'unknown' }],
    })
  })

  it('returns a NULL selection when a model is rated with no registry entry', () => {
    expect(cheapestCapable(['ghost'], 'code', {}, { ghost: cheap })).toEqual({
      model: null,
      skipped: [{ model: 'ghost', reason: 'unknown' }],
    })
  })
})

describe('picks the cheapest capable+rated model across benchmarked domains', () => {
  it('skips a not-capable (different-domain) candidate and wins by inputPerM', () => {
    const registry = {
      priceyCode: codeCapable,
      midCode: codeCapable,
      cheapCode: codeCapable,
      mathOnly: mathCapable,
      unlisted: notCapable,
    }
    const rates = {
      priceyCode: pricey,
      midCode: mid,
      cheapCode: cheap,
      mathOnly: cheap,
      unlisted: cheap,
    }
    // Candidates walk in the given order; mathOnly is not capable of code,
    // unlisted is not capable of anything, and cheapCode has the lowest
    // inputPerM so it wins outright.
    expect(
      cheapestCapable(
        ['priceyCode', 'mathOnly', 'unlisted', 'cheapCode'],
        'code',
        registry,
        rates,
      ),
    ).toEqual({
      model: 'cheapCode',
      skipped: [
        { model: 'mathOnly', reason: 'not-capable' },
        { model: 'unlisted', reason: 'not-capable' },
        { model: 'priceyCode', reason: 'not-selected' },
      ],
    })
  })

  it('handles the math domain through the coerced isCapable gate', () => {
    expect(
      cheapestCapable(
        ['midCode', 'mathOne', 'mathCheap'],
        'math',
        { midCode: codeCapable, mathOne: mathCapable, mathCheap: mathCapable },
        { midCode: cheap, mathOne: mid, mathCheap: cheap },
      ),
    ).toEqual({
      model: 'mathCheap',
      skipped: [
        { model: 'midCode', reason: 'not-capable' },
        { model: 'mathOne', reason: 'not-selected' },
      ],
    })
  })

  it('handles the knowledge domain through the coerced isCapable gate', () => {
    expect(
      cheapestCapable(
        ['knowCheap'],
        'knowledge',
        { knowCheap: knowledgeCapable },
        { knowCheap: cheap },
      ),
    ).toEqual({ model: 'knowCheap', skipped: [] })
  })

  it('handles the reasoning domain by explicit score', () => {
    expect(
      cheapestCapable(
        ['scoreReason'],
        'reasoning',
        { scoreReason: reasoningByScore },
        { scoreReason: mid },
      ),
    ).toEqual({ model: 'scoreReason', skipped: [] })
  })

  it('handles the reasoning domain by highest tier without a score', () => {
    expect(
      cheapestCapable(
        ['tierReason'],
        'reasoning',
        { tierReason: reasoningByTier },
        { tierReason: pricey },
      ),
    ).toEqual({ model: 'tierReason', skipped: [] })
  })
})

describe('pricing tiebreak rules', () => {
  it('resolves a price tie by lowest model name (input equal, output equal)', () => {
    // Both at inputPerM 10, outputPerM 20; the only differentiator is name.
    expect(
      cheapestCapable(
        ['zulu', 'alpha'],
        'code',
        { zulu: codeCapable, alpha: codeCapable },
        { zulu: out20, alpha: out20 },
      ),
    ).toEqual({
      model: 'alpha',
      skipped: [{ model: 'zulu', reason: 'not-selected' }],
    })
  })

  it('picks the lower outputPerM when inputPerM ties', () => {
    expect(
      cheapestCapable(
        ['moreOut', 'lessOut'],
        'code',
        { moreOut: codeCapable, lessOut: codeCapable },
        { moreOut: out30, lessOut: out20 },
      ),
    ).toEqual({
      model: 'lessOut',
      skipped: [{ model: 'moreOut', reason: 'not-selected' }],
    })
  })

  it('keeps the price tie resolving by name when output also ties', () => {
    // Same inputPerM and outputPerM; name decides.
    expect(
      cheapestCapable(
        ['zeta', 'theta', 'alpha'],
        'code',
        { zeta: codeCapable, theta: codeCapable, alpha: codeCapable },
        { zeta: out20, theta: out20, alpha: out20 },
      ),
    ).toEqual({
      model: 'alpha',
      skipped: [
        { model: 'zeta', reason: 'not-selected' },
        { model: 'theta', reason: 'not-selected' },
      ],
    })
  })
})

describe('skip reasons for non-winning candidates', () => {
  it('tags a capable-but-unrated model as unrated', () => {
    expect(
      cheapestCapable(
        ['rated', 'unrated'],
        'code',
        { rated: codeCapable, unrated: codeCapable },
        { rated: cheap },
      ),
    ).toEqual({
      model: 'rated',
      skipped: [{ model: 'unrated', reason: 'unrated' }],
    })
  })

  it('tags a not-capable model as not-capable', () => {
    expect(
      cheapestCapable(
        ['only'],
        'code',
        { only: notCapable },
        { only: cheap },
      ),
    ).toEqual({
      model: null,
      skipped: [{ model: 'only', reason: 'not-capable' }],
    })
  })

  it('keeps a champion that is already the cheapest (higher input loses)', () => {
    // There is already a champion (a 10): the pricey 30 contender loses on
    // inputPerM, staying eligible-but-not-selected.
    expect(
      cheapestCapable(
        ['winner', 'second'],
        'code',
        { winner: codeCapable, second: codeCapable },
        { winner: cheap, second: pricey },
      ),
    ).toEqual({
      model: 'winner',
      skipped: [{ model: 'second', reason: 'not-selected' }],
    })
  })

  it('keeps the champion when the contender ties input but costs more output', () => {
    expect(
      cheapestCapable(
        ['cheap', 'costlier'],
        'code',
        { cheap: codeCapable, costlier: codeCapable },
        { cheap: out20, costlier: out30 },
      ),
    ).toEqual({
      model: 'cheap',
      skipped: [{ model: 'costlier', reason: 'not-selected' }],
    })
  })

  it('keeps the champion when the contender ties price but sorts after by name', () => {
    expect(
      cheapestCapable(
        ['alpha', 'zeta'],
        'code',
        { alpha: codeCapable, zeta: codeCapable },
        { alpha: out20, zeta: out20 },
      ),
    ).toEqual({
      model: 'alpha',
      skipped: [{ model: 'zeta', reason: 'not-selected' }],
    })
  })
})

describe('simple domain: no capability gate, only the rates gate applies', () => {
  // For 'simple', every registered candidate is trivially capable, whether or
  // not its benchmark bags are populated. Only pricing decides.
  it('lets a not-capable model win under simple when it is the cheapest', () => {
    expect(
      cheapestCapable(
        ['plain', 'codey'],
        'simple',
        { plain: notCapable, codey: codeCapable },
        { plain: cheap, codey: mid },
      ),
    ).toEqual({
      model: 'plain',
      skipped: [{ model: 'codey', reason: 'not-selected' }],
    })
  })

  it('rejects an unrated candidate under simple (rates gate only)', () => {
    expect(
      cheapestCapable(
        ['plain'],
        'simple',
        { plain: notCapable },
        {},
      ),
    ).toEqual({
      model: null,
      skipped: [{ model: 'plain', reason: 'unrated' }],
    })
  })

  it('scores every registered model as trivially capable regardless of benchmark bags', () => {
    const result = cheapestCapable(
      ['capable', 'plain'],
      'simple',
      { capable: codeCapable, plain: notCapable },
      { capable: cheap, plain: pricey },
    )
    expect(result.model).toBe('capable')
    expect(result.skipped).toEqual([{ model: 'plain', reason: 'not-selected' }])
  })
})

describe('determinism and the golden rule', () => {
  const registry = {
    cheapCode: codeCapable,
    priceyCode: codeCapable,
    mathOnly: mathCapable,
  }
  const rates = { cheapCode: cheap, priceyCode: pricey, mathOnly: cheap }

  it('returns deeply-equal deterministic results for equal inputs', () => {
    const args: [readonly string[], TaskDomain] = [
      ['priceyCode', 'mathOnly', 'cheapCode'],
      'code',
    ]
    const first = cheapestCapable(args[0], args[1], registry, rates)
    const second = cheapestCapable(args[0], args[1], registry, rates)
    expect(second).toEqual(first)
    expect(second.model).toBe(first.model)
    expect(second.skipped).toEqual(first.skipped)
  })

  it('returns a fresh output object on every call (no shared mutable state)', () => {
    const first = cheapestCapable(['cheapCode', 'priceyCode'], 'code', registry, rates)
    const rerun = cheapestCapable(['cheapCode', 'priceyCode'], 'code', registry, rates)
    expect(rerun).toEqual(first)
    expect(rerun).not.toBe(first)
  })
})

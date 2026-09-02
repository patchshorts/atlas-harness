import { describe, expect, it } from 'vitest'
import {
  classify,
  cosineSimilarity,
  EMBEDDING_DIMENSION,
  LOW_CONFIDENCE_THRESHOLD,
  TaskDomain,
} from '../src/routing/domain.ts'

// A deterministic fake embedFn: maps a fixed set of key phrases to
// hand-set embeddings in the classifier's 4-dimensional space. No randomness,
// no live LLM, no network — the classifier result is fully predictable.
const EMBEDDINGS: Readonly<Record<string, readonly number[]>> = {
  'find and fix the null dereference': [1, 0, 0, 0],
  'integrate this by u-substitution': [0, 1, 0, 0],
  'which planet is the largest': [0, 0, 1, 0],
  'infer the underlying rule': [0, 0, 0, 1],
  'trivial preamble': [0.5, 0.5, 0.5, 0.5],
  'no signal': [0, 0, 0, 0],
}

const ZERO_VECTOR: readonly number[] = [0, 0, 0, 0]

const fakeEmbed = (): ((text: string) => number[]) => (text: string): number[] => [
  ...(EMBEDDINGS[text] ?? ZERO_VECTOR),
]

describe('cosine similarity', () => {
  it('scores identical unit vectors at 1', () => {
    expect(cosineSimilarity([1, 0, 0, 0], [1, 0, 0, 0])).toBe(1)
  })

  it('scores orthogonal unit vectors at exactly 0', () => {
    expect(cosineSimilarity([1, 0, 0, 0], [0, 1, 0, 0])).toBe(0)
  })

  it('scores anti-parallel unit vectors at exactly -1', () => {
    expect(cosineSimilarity([1, 0, 0, 0], [-1, 0, 0, 0])).toBe(-1)
  })

  it('interprets a vector shorter than a prototype as zero-padded', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0, 0])).toBe(1)
  })

  it('zero-pads a second vector shorter than the first', () => {
    expect(cosineSimilarity([1, 0, 0, 0], [1, 0])).toBe(1)
  })

  it('reads only the first EMBEDDING_DIMENSION entries of a longer vector', () => {
    expect(cosineSimilarity([1, 0, 0, 0], [1, 0, 0, 0, 99])).toBe(1)
  })

  it('defines cosine of an empty first vector as 0', () => {
    expect(cosineSimilarity([], [0, 1, 0, 0])).toBe(0)
  })

  it('defines cosine of a zero second vector as 0', () => {
    expect(cosineSimilarity([1, 0, 0, 0], [0, 0, 0, 0])).toBe(0)
  })
})

describe('task-domain classifier', () => {
  it('routes a strongly code-aligned prompt to code at confidence 1', () => {
    expect(classify('find and fix the null dereference', fakeEmbed())).toEqual({
      domain: 'code',
      confidence: 1,
    })
  })

  it('routes a strongly math-aligned prompt to math at confidence 1', () => {
    expect(classify('integrate this by u-substitution', fakeEmbed())).toEqual({
      domain: 'math',
      confidence: 1,
    })
  })

  it('routes a strongly knowledge-aligned prompt to knowledge at confidence 1', () => {
    expect(classify('which planet is the largest', fakeEmbed())).toEqual({
      domain: 'knowledge',
      confidence: 1,
    })
  })

  it('routes a strongly reasoning-aligned prompt to reasoning at confidence 1', () => {
    const result = classify('infer the underlying rule', fakeEmbed())
    expect(result).toEqual({ domain: 'reasoning', confidence: 1 })
  })

  it('picks the highest-similarity prototype and clamps its cosine to [0,1]', () => {
    // Equal pull toward every axis scores cosine 0.5 against each prototype;
    // the first (code) wins, with confidence in the mid-range.
    expect(classify('trivial preamble', fakeEmbed())).toEqual({
      domain: 'code',
      confidence: 0.5,
    })
  })

  it('falls back to reasoning when the best cosine undercuts the threshold', () => {
    const embedding = fakeEmbed()
    const result = classify('no signal', embedding)
    expect(result.domain).toBe('reasoning')
    expect(result.confidence).toBe(0)
    expect(result.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD)
  })

  it('clamps a negative winning cosine to a confidence of 0', () => {
    const result = classify('anti-code', (): number[] => [-1, 0, 0, 0])
    expect(result.domain).toBe('reasoning')
    expect(result.confidence).toBe(0)
  })

  it('never crashes on an empty embedding', () => {
    const result = classify('empty', (): number[] => [])
    expect(result).toEqual({ domain: 'reasoning', confidence: 0 })
  })
})

describe('golden rule: classify is a pure function of (prompt, embedFn)', () => {
  const embed = fakeEmbed()

  it('returns deeply-equal deterministic results for equal inputs', () => {
    const first = classify('integrate this by u-substitution', embed)
    const second = classify('integrate this by u-substitution', embed)
    expect(second).toEqual(first)
    expect(second.domain).toBe(first.domain)
    expect(second.confidence).toBe(first.confidence)
  })

  it('returns a fresh output object on every call (no shared mutable state)', () => {
    const first = classify('find and fix the null dereference', embed)
    const mutatedCopy = { ...first, domain: 'simple' as TaskDomain }
    // Mutating the caller's copy must not leak into a later call's result.
    void mutatedCopy
    const rerun = classify('find and fix the null dereference', embed)
    expect(rerun).toEqual(first)
    expect(rerun).not.toBe(first)
  })

  it('exposes the embedding dimension and threshold constants it classifies by', () => {
    expect(EMBEDDING_DIMENSION).toBe(4)
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.35)
  })
})

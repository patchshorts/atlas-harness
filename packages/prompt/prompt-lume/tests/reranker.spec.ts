import { describe, expect, it } from 'vitest'
import { rerank, type RerankCandidate } from '../src/index.ts'

/** Minimal recall-shaped candidate helper; content embeds the id for scorer routing. */
function cand(partial: Partial<RerankCandidate> & Pick<RerankCandidate, 'id'>): RerankCandidate {
  return {
    content: 'chunk ' + partial.id,
    namespace: 'agent-instructions',
    corpus: 'workspace',
    score: 0.5,
    ...partial,
  }
}

/** Encoder that maps the chunk id (embedded in content) to a rerank score. */
function scorer(routes: Record<string, number>): (query: string, content: string) => number {
  return (_query, content) => routes[content.split(' ')[1]!]!
}

describe('rerank', () => {
  it('with an encoder drops below-threshold results and keeps above-threshold ones', async () => {
    const candidates = [cand({ id: 'a', score: 0.8 }), cand({ id: 'b', score: 0.9 }), cand({ id: 'c', score: 0.1 })]

    const result = await rerank('q', candidates, {
      encoder: scorer({ a: 0.9, b: 0.9, c: 0.1 }),
      threshold: 0.5,
    })

    expect(result.map(r => r.id)).toEqual(['a', 'b'])
    expect(result.every(r => r.rerankScore >= 0.5)).toBe(true)
  })

  it('with an encoder re-orders away from recall order and keeps ties stable', async () => {
    // recall order [A(best), B, C]; encoder re-scores B above A, and C ties A.
    const candidates = [cand({ id: 'A', score: 0.8 }), cand({ id: 'B', score: 0.6 }), cand({ id: 'C', score: 0.3 })]

    const result = await rerank('q', candidates, { encoder: scorer({ A: 0.3, B: 0.95, C: 0.3 }) })

    expect(result.map(r => r.id)).toEqual(['B', 'A', 'C'])
    expect(result[0]!.rerankScore).toBe(0.95)
  })

  it('without an encoder preserves recall order, uses candidate score, respects threshold and limit', async () => {
    const candidates = [cand({ id: 'best', score: 0.9 }), cand({ id: 'mid', score: 0.6 }), cand({ id: 'low', score: 0.2 })]

    const full = await rerank('q', candidates)
    expect(full.map(r => r.id)).toEqual(['best', 'mid', 'low'])
    expect(full.map(r => r.rerankScore)).toEqual([0.9, 0.6, 0.2])

    const thresholded = await rerank('q', candidates, { threshold: 0.5 })
    expect(thresholded.map(r => r.id)).toEqual(['best', 'mid'])
    expect(thresholded.every(r => r.rerankScore === r.score)).toBe(true)

    const limited = await rerank('q', candidates, { limit: 2 })
    expect(limited.map(r => r.id)).toEqual(['best', 'mid'])
  })

  it('handles an async encoder and empty input without crashing', async () => {
    expect(await rerank('q', [])).toEqual([])
    expect(await rerank('q', [], { limit: 3 })).toEqual([])

    const candidate = cand({ id: 'x', score: 0.7 })
    const asyncRerank = await rerank('q', [candidate], {
      encoder: async (_q, content) => {
        const routed = scorer({ x: 0.8 })(_q, content)
        return await Promise.resolve(routed)
      },
      threshold: 0.5,
    })
    expect(asyncRerank.map(r => r.id)).toEqual(['x'])
    expect(asyncRerank[0]!.rerankScore).toBe(0.8)
  })

  it('never mutates the input candidates array', async () => {
    const candidates = [cand({ id: 'a', score: 0.8 }), cand({ id: 'b', score: 0.6 }), cand({ id: 'c', score: 0.3 })]
    const snapshot = JSON.stringify(candidates)

    await rerank('q', candidates, { encoder: () => 0.5, threshold: 0.1, limit: 1 })

    expect(JSON.stringify(candidates)).toBe(snapshot)
  })
})

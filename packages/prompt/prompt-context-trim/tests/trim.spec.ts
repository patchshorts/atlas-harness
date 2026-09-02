import { describe, expect, it } from 'vitest'
import { PromptContextTrimService, trimSurface } from '../src/index.ts'
import type { SurfaceLine } from '../src/index.ts'
import { Context } from '@deepseek-ai/cordis'

/** Build a line set with a deterministic byte size per line. */
function lines(entries: Array<[seq: number, text: string]>): SurfaceLine[] {
  return entries.map(([seq, text]) => ({ seq, text }))
}

/** Fake measure: each line costs `text.length` bytes (ASCII assumption). */
const asciiMeasure = (text: string): number => text.length

describe('prompt-context-trim trimSurface (verbatim deletion-not-rewrite)', () => {
  it('returns the surface unchanged when it is within the threshold', () => {
    const surface = lines([
      [1, 'aaaa'],   // 4
      [2, 'bbbb'],   // 4
      [3, 'cccc'],   // 4
    ])
    const result = trimSurface(surface, {
      thresholdBytes: 100,
      retainFloorBytes: 4,
      measure: asciiMeasure,
    })
    expect(result.kind).toBe('none')
    if (result.kind !== 'none') return
    expect(result.surface.map(l => l.seq)).toEqual([1, 2, 3])
    expect(result.surface.map(l => l.bytes)).toEqual([4, 4, 4])
  })

  it('prunes oldest lines verbatim to surviving tail when over threshold', () => {
    // 6 lines x 4 bytes = 24 total. Threshold 12 → keep a 12-byte tail.
    const surface = lines([
      [1, 'aaaa'],
      [2, 'bbbb'],
      [3, 'cccc'],
      [4, 'dddd'],
      [5, 'eeee'],
      [6, 'ffff'],
    ])
    const result = trimSurface(surface, {
      thresholdBytes: 12,
      retainFloorBytes: 4,
      measure: asciiMeasure,
    })
    expect(result.kind).toBe('verbatim')
    if (result.kind !== 'verbatim') return
    // Oldest 3 deleted; tail [4,5,6] survives verbatim (12 bytes <= 12).
    expect(result.pruned.map(l => l.seq)).toEqual([1, 2, 3])
    expect(result.surface.map(l => l.seq)).toEqual([4, 5, 6])
    // Survivors are byte-identical to the input text (deletion, not rewrite).
    expect(result.surface.map(l => l.text)).toEqual(['dddd', 'eeee', 'ffff'])
    const tailBytes = result.surface.reduce((s, l) => s + l.bytes, 0)
    expect(tailBytes).toBeLessThanOrEqual(12)
    expect(tailBytes).toBeGreaterThanOrEqual(4) // floor honored
  })

  it('honors the verbatim floor: never deletes into the most-recent tail', () => {
    const surface = lines([
      [1, 'aaaa'],   // 4
      [2, 'bbbb'],   // 4
      [3, 'cccc'],   // 4
      [4, 'dddd'],   // 4
      [5, 'eeee'],   // 4  <- floor starts here (8 bytes: eeee+dddd)
      [6, 'ffff'],   // 4
    ])
    const result = trimSurface(surface, {
      thresholdBytes: 8,
      retainFloorBytes: 8, // floor = last 8 bytes => keep seq 5,6; can only delete 1-4
      measure: asciiMeasure,
    })
    expect(result.kind).toBe('verbatim')
    if (result.kind !== 'verbatim') return
    expect(result.pruned.map(l => l.seq)).toEqual([1, 2, 3, 4])
    expect(result.surface.map(l => l.seq)).toEqual([5, 6])
    // Surviving tail byte size == floor == 8.
    const tailBytes = result.surface.reduce((s, l) => s + l.bytes, 0)
    expect(tailBytes).toBe(8)
  })

  it('falls back to summarize when the verbatim floor alone still exceeds the threshold', () => {
    // 4 lines x 6 bytes = 24. Floor 16 keeps the shortest tail >= 16 = seq2+seq3+seq4 (18).
    // floorSize 18 > threshold 10 → deletion cannot reach the budget.
    const surface = lines([
      [1, 'aaaaaa'],   // 6
      [2, 'bbbbbb'],   // 6
      [3, 'cccccc'],   // 6
      [4, 'dddddd'],   // 6
    ])
    const result = trimSurface(surface, {
      thresholdBytes: 10,
      retainFloorBytes: 16,
      measure: asciiMeasure,
    })
    expect(result.kind).toBe('summarize')
    if (result.kind !== 'summarize') return
    // pruned head is the deletable span; retained floor tail stays verbatim.
    expect(result.pruned.map(l => l.seq)).toEqual([1])
    expect(result.retained.map(l => l.seq)).toEqual([2, 3, 4])
    // surface is the full measured input, unchanged (caller condenses pruned).
    expect(result.surface.map(l => l.seq)).toEqual([1, 2, 3, 4])
  })

  it('falls back to summarize when the whole surface is the floor and still over budget', () => {
    const surface = lines([
      [1, 'aaaa'],
      [2, 'bbbb'],
    ])
    const result = trimSurface(surface, {
      thresholdBytes: 4,
      retainFloorBytes: 12, // floor >= whole surface → nothing deletable
      measure: asciiMeasure,
    })
    expect(result.kind).toBe('summarize')
    if (result.kind !== 'summarize') return
    expect(result.pruned).toEqual([])
    expect(result.retained.map(l => l.seq)).toEqual([1, 2])
  })

  it('returns none for an empty surface', () => {
    const result = trimSurface([], {
      thresholdBytes: 10,
      retainFloorBytes: 4,
    })
    expect(result.kind).toBe('none')
  })

  it('uses default UTF-8 byte measure when no measure is supplied', () => {
    const surface = lines([
      [1, 'abc'],        // 3 bytes ASCII
      [2, 'é'],          // 2 bytes UTF-8
      [3, '日本語'],       // 9 bytes UTF-8
    ])
    const result = trimSurface(surface, {
      thresholdBytes: 12, // total 14 > 12; floor 2 = seq3 alone (9)
      retainFloorBytes: 2,
    })
    expect(result.kind).toBe('verbatim')
    if (result.kind !== 'verbatim') return
    // Default UTF-8 measure: seq1=3, seq2=2, seq3=9. Longest suffix <= 12 = seq2+seq3 (11).
    expect(result.surface.map(l => l.seq)).toEqual([2, 3])
    expect(result.surface.map(l => l.bytes)).toEqual([2, 9])
  })
})

describe('prompt-context-trim service', () => {
  it('registers ctx.promptContextTrim and trims over-threshold surfaces', () => {
    const ctx = new Context()
    const service = new PromptContextTrimService(ctx, {
      thresholdBytes: 8,
      retainFloorBytes: 4,
    })
    const surface = lines([
      [1, 'aaaa'],
      [2, 'bbbb'],
      [3, 'cccc'],
      [4, 'dddd'],
    ])
    const result = service.trim(surface, { measure: asciiMeasure })
    expect(result.kind).toBe('verbatim')
    if (result.kind !== 'verbatim') return
    expect(result.surface.map(l => l.seq)).toEqual([3, 4])
  })

  it('is disabled via config and returns the surface unchanged', () => {
    const ctx = new Context()
    const service = new PromptContextTrimService(ctx, { enabled: false })
    const surface = lines([
      [1, 'aaaa'],
      [2, 'bbbb'],
      [3, 'cccc'],
    ])
    const result = service.trim(surface)
    expect(result.kind).toBe('none')
    if (result.kind !== 'none') return
    expect(result.surface.map(l => l.seq)).toEqual([1, 2, 3])
  })
})

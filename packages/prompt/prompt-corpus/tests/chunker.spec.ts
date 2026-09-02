import { describe, expect, it } from 'vitest'
import { chunkDocument } from '../src/chunker.ts'

const DOC = [
  '# Harness Identity',
  '',
  'You are a DeepSeek Harness agent.',
  '',
  '## Persona',
  '',
  'You write dense, correct code.',
  '',
  '## Capabilities',
  '',
  '- run bash',
  '- recall memories',
  '',
  '# Workspace Rules',
  '',
  'Follow AGENTS.md for this directory.',
  '',
  '## Safety',
  '',
  'Never expose secrets with {{credential.name}}.',
  '',
  '## Budgets',
  '',
  'Respect the token budget.',
].join('\n')

describe('prompt-corpus chunker', () => {
  it('splits a heading-delimited doc at semantic section boundaries', () => {
    const chunks = chunkDocument(DOC, { corpus: 'system', scope: 'workspace' })
    // 2 H1 sections, each with two sub-headings = 6 chunks, no phantom preamble
    expect(chunks).toHaveLength(6)
    expect(chunks.map(c => c.heading)).toEqual([
      'Harness Identity',
      'Persona',
      'Capabilities',
      'Workspace Rules',
      'Safety',
      'Budgets',
    ])
    // each chunk starts with its own heading line and covers all body text
    expect(chunks[0]!.content.startsWith('# Harness Identity')).toBe(true)
    expect(chunks[0]!.content).toContain('You are a DeepSeek Harness agent.')
    expect(chunks[2]!.content).toContain('- run bash')
    // the last chunk carries the final section body
    expect(chunks[5]!.content).toContain('Respect the token budget.')
  })

  it('tags every chunk with corpus, scope, specificityRank, and cacheStable metadata', () => {
    const chunks = chunkDocument(DOC, { corpus: 'soul', scope: 'identity' })
    for (const chunk of chunks) {
      expect(chunk.corpus).toBe('soul')
      expect(chunk.scope).toBe('identity')
      expect(chunk.specificityRank).toBeGreaterThanOrEqual(1)
      expect(typeof chunk.cacheStable).toBe('boolean')
      expect(chunk.index).toBeGreaterThanOrEqual(0)
    }
    // H1 = rank 1, H2 = rank 2 (deeper heading = more specific)
    expect(chunks[0]!.specificityRank).toBe(1)
    expect(chunks[1]!.specificityRank).toBe(2)
    expect(chunks[3]!.specificityRank).toBe(1)
  })

  it('marks chunks containing per-turn variables as non-cacheable', () => {
    const chunks = chunkDocument(DOC)
    const safety = chunks.find(c => c.heading === 'Safety')
    expect(safety).toBeDefined()
    expect(safety?.cacheStable).toBe(false)
    // a static chunk is cache-stable
    const persona = chunks.find(c => c.heading === 'Persona')
    expect(persona?.cacheStable).toBe(true)
  })

  it('handles preamble, empty, and heading-only inputs', () => {
    // leading text before any heading -> separate preamble chunk, rank 0
    const plain = chunkDocument('prologue line\n# Real Section\nbody here', { corpus: 'soul' })
    expect(plain.map(c => c.heading)).toEqual(['', 'Real Section'])
    expect(plain[0]!.specificityRank).toBe(0)
    expect(plain[1]!.specificityRank).toBe(1)

    // empty document -> no chunks
    expect(chunkDocument('')).toHaveLength(0)
    // heading-only doc -> one heading chunk, its heading preserved
    const headingOnly = chunkDocument('# Title')
    expect(headingOnly).toHaveLength(1)
    expect(headingOnly[0]!.heading).toBe('Title')
    expect(headingOnly[0]!.content).toBe('# Title')
  })
})

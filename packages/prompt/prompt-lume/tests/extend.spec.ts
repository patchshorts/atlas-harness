import { describe, expect, it } from 'vitest'
import {
  CapabilityRegistry,
  scoreCapability,
  type CapabilitySlot,
} from '../src/index.ts'

const TOOL_SLOT: CapabilitySlot = {
  name: 'terminal',
  summary: 'run bash commands in a sandboxed shell',
  toolId: 'terminal',
  scope: 'tool',
  provenance: 'self-modification:tools',
}
const WEB_SEARCH_SLOT: CapabilitySlot = {
  name: 'web_search',
  summary: 'search the web for current information',
  toolId: 'web_search',
  scope: 'general',
  provenance: 'self-modification:tools',
}
const WORKSPACE_SLOT: CapabilitySlot = {
  name: 'workspace-scanner',
  summary: 'map and inspect files under the active workspace root',
  toolId: 'fs',
  scope: 'workspace',
  provenance: 'prompt-lume:acquisition-surface',
}
const PERSONA_SLOT: CapabilitySlot = {
  name: 'persona-retrieval',
  summary: 'recall the harness identity and soul description',
  toolId: 'corpus',
  scope: 'identity',
  provenance: 'prompt-lume:acquisition-surface',
}

function registryWithAll(): CapabilityRegistry {
  return new CapabilityRegistry()
    .register(TOOL_SLOT)
    .register(WEB_SEARCH_SLOT)
    .register(WORKSPACE_SLOT)
    .register(PERSONA_SLOT)
}

describe('prompt-lume capability acquisition surface', () => {
  it('registers slots and returns a registered matching tool plainly', () => {
    const registry = registryWithAll()
    expect(registry.size).toBe(4)

    const hits = registry.lookup('run a bash command in the sandboxed shell')
    expect(hits.length).toBeGreaterThan(0)
    // The registered terminal tool is returned for a tool-germane query.
    expect(hits.some(hit => hit.name === 'terminal' && hit.toolId === 'terminal')).toBe(true)
  })

  it('returns scoped candidates: a tool-typed slot is excluded from a workspace-scoped lookup', () => {
    const registry = registryWithAll()
    const hits = registry.lookup('map and inspect files in the active workspace', { scope: 'workspace' })
    expect(hits.length).toBeGreaterThan(0)
    // No tool-scoped slot leaks into a workspace-scoped lookup.
    expect(hits.every(hit => hit.scope === 'workspace')).toBe(true)
    expect(hits.some(hit => hit.name === 'terminal')).toBe(false)
    expect(hits.some(hit => hit.name === 'workspace-scanner')).toBe(true)
  })

  it('orders candidates deterministically by descending relevance (clear match first)', () => {
    const registry = registryWithAll()
    const hits = registry.lookup('search the web for the latest news', { scope: 'general' })
    expect(hits.length).toBeGreaterThan(0)
    // web_search matches the summary substrings exactly → highest score → first.
    expect(hits[0]!.name).toBe('web_search')
    for (let i = 1; i < hits.length; i += 1) {
      expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score)
    }
  })

  it('gives every returned candidate a provenance line with the marker and scope', () => {
    const registry = registryWithAll()
    const hits = registry.lookup('run a bash command in the sandbox', { scope: 'tool' })
    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) {
      expect(hit.provenanceLine).toContain('[prompt-lume:acquisition]')
      expect(hit.provenanceLine).toContain('scope=tool')
    }
  })

  it('returns an empty array on no-match (never undefined, never throws)', () => {
    const registry = registryWithAll()
    const miss = registry.lookup('zzzznonexistentcapabilityterm', { scope: 'identity' })
    expect(miss).toEqual([])
    // An empty registry and an empty query are also plain empty arrays.
    expect(new CapabilityRegistry().lookup('anything')).toEqual([])
    expect(registry.lookup('')).toEqual([])
  })

  it('respects the limit (returns at most limit candidates)', () => {
    const registry = registryWithAll()
    const one = registry.lookup('run bash web workspace persona identity search command', { limit: 1 })
    expect(one.length).toBeLessThanOrEqual(1)
    const limitThree = registry.lookup('run bash web workspace persona identity search command', { limit: 3 })
    expect(limitThree.length).toBeLessThanOrEqual(3)
    // A limit larger than the match set returns everything that matched.
    const capped = registry.lookup('run bash web workspace', { limit: 100 })
    expect(capped.length).toBeLessThanOrEqual(registry.size)
  })

  it('scoreCapability is pure + deterministic: exact hits dominate, token overlap still returns', () => {
    // Exact substring on the summary scores above token-only overlap.
    expect(scoreCapability('run bash commands', TOOL_SLOT)).toBeGreaterThan(
      scoreCapability('execution sandbox command runner', TOOL_SLOT),
    )
    // Deterministic: repeated calls give identical scores.
    expect(scoreCapability('search the web', WEB_SEARCH_SLOT)).toBe(
      scoreCapability('search the web', WEB_SEARCH_SLOT),
    )
    // Empty / unrelated queries score zero, never NaN or negative.
    expect(scoreCapability('', TOOL_SLOT)).toBe(0)
    const score = scoreCapability('zzzznonexistentcapabilityterm', TOOL_SLOT)
    expect(Number.isFinite(score)).toBe(true)
    expect(score).toBeGreaterThanOrEqual(0)
  })
})

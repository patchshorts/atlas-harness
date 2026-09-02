import { describe, expect, it } from 'vitest'
import {
  CapabilityRegistry,
  widenOnMiss,
  type CapabilitySlot,
  type WidenPolicy,
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

function registryWithAll(): CapabilityRegistry {
  return new CapabilityRegistry()
    .register(TOOL_SLOT)
    .register(WEB_SEARCH_SLOT)
    .register(WORKSPACE_SLOT)
}

/** A fixed escalation ladder: relax scope, then widen further. */
const ESCALATE: WidenPolicy = {
  label: 't14-escalate-scope-then-budget',
  steps: [
    { scope: 'general', limit: 2, budgetBytes: 2048 },
    { scope: 'all', limit: 3, budgetBytes: 4096 },
  ],
}

describe('prompt-lume fallback widen-hook on miss', () => {
  it('passes the base result through untouched when the base already hits', () => {
    const registry = registryWithAll()
    const base = { scope: 'tool' as const }
    const outcome = widenOnMiss(
      registry,
      'run bash commands in a sandboxed shell',
      base,
      512,
      ESCALATE,
    )
    expect(outcome.widened).toBe(false)
    expect(outcome.candidates.some(c => c.name === 'terminal')).toBe(true)
    // The base budget is honored — no widening means no budget raise.
    expect(outcome.budgetBytes).toBe(512)
    expect(outcome.provenanceLine).toContain('widen=noop')
  })

  it('widen: a forced scope miss widens the hook to span another corpus', () => {
    const registry = registryWithAll()
    // A workspace-germane query with zero token overlap against the terminal
    // slot misses completely under a tool-scoped lookup.
    const base = { scope: 'tool' as const }
    const miss = registry.lookup('inspect workspace files', base)
    expect(miss).toEqual([])

    const outcome = widenOnMiss(
      registry,
      'inspect workspace files',
      base,
      512,
      ESCALATE,
    )
    // The forced miss widened the hook and recovered the workspace slot.
    expect(outcome.widened).toBe(true)
    expect(outcome.step).toBe(1) // only the 'all' step spans the workspace corpus
    expect(outcome.candidates.some(c => c.name === 'workspace-scanner')).toBe(true)
  })

  it('widen: spans MORE corpora than the strict lookup allowed', () => {
    const registry = registryWithAll()
    const base = { scope: 'tool' as const, limit: 1 }
    const outcome = widenOnMiss(
      registry,
      'search the web for current information across every corpus',
      base,
      512,
      ESCALATE,
    )
    expect(outcome.widened).toBe(true)
    // The widen hook is no longer tool-scoped — web_search (general) is spanned.
    expect(outcome.candidates.some(c => c.name === 'web_search')).toBe(true)
    // A strict tool-scoped lookup could never surface a general-scoped slot.
    expect(registry.lookup('search the web', base)).toEqual([])
  })

  it('widen: commits MORE under budget (raised byte budget ceiling on the fired step)', () => {
    const registry = registryWithAll()
    // A workspace-germane query with zero token overlap against the terminal
    // slot misses the strict lookup entirely, forcing the widen-hook to fire.
    const base = { scope: 'tool' as const, limit: 1 }
    expect(registry.lookup('inspect workspace files', base)).toEqual([])

    const outcome = widenOnMiss(
      registry,
      'inspect workspace files',
      base,
      512,
      ESCALATE,
    )
    expect(outcome.widened).toBe(true)
    expect(outcome.step).toBe(1) // only the 'all' step spans the workspace corpus
    // The fired step raised the region byte budget 512 → 4096 (commit more).
    expect(outcome.budgetBytes).toBe(4096)
    expect(outcome.candidates.some(c => c.name === 'workspace-scanner')).toBe(true)
    // The provenance line records the widened budget ceiling.
    expect(outcome.provenanceLine).toContain('budget=4096')
  })

  it('widen: a narrower ladder step may recover with a raised cap + budget first', () => {
    const registry = new CapabilityRegistry().register(WEB_SEARCH_SLOT)
    // A general-scoped miss under a tool scope — the first step already recovers.
    const base = { scope: 'tool' as const, limit: 1 }
    const outcome = widenOnMiss(
      registry,
      'search the web for current information',
      base,
      512,
      ESCALATE,
    )
    expect(outcome.widened).toBe(true)
    expect(outcome.step).toBe(0)
    expect(outcome.budgetBytes).toBe(2048) // the FIRST step's raised budget
    expect(outcome.candidates.some(c => c.name === 'web_search')).toBe(true)
  })

  it('widen: never fabricates a rescue when every step still misses (finite wall)', () => {
    const registry = registryWithAll()
    const base = { scope: 'tool' as const }
    const outcome = widenOnMiss(
      registry,
      'zzzznonexistentcapabilityterm across any scope',
      base,
      512,
      ESCALATE,
    )
    expect(outcome.widened).toBe(false)
    expect(outcome.candidates).toEqual([])
    // The wall holds — the base budget is reported, not a widened one.
    expect(outcome.budgetBytes).toBe(512)
    expect(outcome.provenanceLine).toContain('widen=miss')
  })
})

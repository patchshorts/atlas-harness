import { describe, expect, it } from 'vitest'
import {
  CapabilityRegistry,
  guardExtension,
  DENY_ALL,
  type CapabilitySlot,
  type SelfExtensionBudget,
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
  label: 't15-escalate-scope-then-budget',
  steps: [
    { scope: 'general', limit: 2, budgetBytes: 2048 },
    { scope: 'all', limit: 3, budgetBytes: 4096 },
  ],
}

describe('prompt-lume self-extension budget + guardrails', () => {
  it('passes the base result through the cap when the base already hits', () => {
    const registry = registryWithAll()
    const budget: SelfExtensionBudget = { maxCandidates: 2, maxBudgetBytes: 512 }
    const decision = guardExtension(
      registry,
      'run bash commands in a sandboxed shell',
      { scope: 'tool' },
      512,
      ESCALATE,
      budget,
    )
    // Base hit — no widening, no cap bit (2 candidates within the cap).
    expect(decision.capped).toBe(false)
    expect(decision.approved).toEqual([])
    expect(decision.rejected.some(c => c.name === 'terminal')).toBe(true)
    expect(decision.budgetBytes).toBe(512)
    expect(decision.provenanceLine).toContain('widen=noop')
  })

  it('enforces the maxCandidates cap — a wider result is clamped before reporting', () => {
    const registry = registryWithAll()
    // A query germane to BOTH the terminal and web_search slots recovers two
    // candidates from the all-scope lookup; the cap holds at one.
    const budget: SelfExtensionBudget = { maxCandidates: 1, maxBudgetBytes: 4096 }
    const decision = guardExtension(
      registry,
      'run and search',
      {}, // no scope restriction → all scopes eligible for the base lookup
      512,
      ESCALATE,
      budget,
    )
    expect(decision.capped).toBe(true)
    // The candidate slice is clamped to the cap: only the top-scored one.
    expect(decision.rejected.length).toBe(1)
    expect(decision.rejected.length + decision.approved.length).toBe(1)
    expect(decision.budgetBytes).toBe(512) // base budget — no widening fired
    expect(decision.provenanceLine).toContain('capped=1')
  })

  it('enforces the maxBudgetBytes cap — a raised byte budget is clamped to the ceiling', () => {
    const registry = registryWithAll()
    // The widen ladder would raise the budget 512 → 4096; the cap holds at 2048.
    const budget: SelfExtensionBudget = { maxCandidates: 3, maxBudgetBytes: 2048 }
    const decision = guardExtension(
      registry,
      'inspect workspace files',
      { scope: 'tool', limit: 1 },
      512,
      ESCALATE,
      budget,
    )
    expect(decision.capped).toBe(true)
    // The byte budget never exceeds the hard ceiling.
    expect(decision.budgetBytes).toBe(2048)
    expect(decision.budgetBytes).toBeLessThanOrEqual(2048)
    expect(decision.provenanceLine).toContain('budget=2048')
  })

  it('caps the widen ladder traversal with maxWidenSteps', () => {
    const registry = registryWithAll()
    // Only the FIRST step runs; a workspace-only-recoverable candidate (via
    // the wider 'all' step) is never reached → the turn stays a miss (wall).
    const budget: SelfExtensionBudget = { maxCandidates: 3, maxBudgetBytes: 4096, maxWidenSteps: 1 }
    const decision = guardExtension(
      registry,
      'inspect workspace files',
      { scope: 'tool', limit: 1 },
      512,
      ESCALATE,
      budget,
    )
    // The 'all' step (step 1) is capped away, so the workspace slot is not
    // recovered — the finite wall holds; nothing is fabricated.
    expect(decision.rejected.some(c => c.name === 'workspace-scanner')).toBe(false)
    expect(decision.approved.length).toBe(0)
  })

  it('approval gate: only approved candidates land in the additions plan', () => {
    const registry = registryWithAll()
    const budget: SelfExtensionBudget = { maxCandidates: 3, maxBudgetBytes: 4096 }
    const approveTerminal = (c: { name: string }): boolean => c.name === 'terminal'
    const decision = guardExtension(
      registry,
      'run bash commands and also search the web',
      {}, // unrestricted base → both terminal (tool) and web_search (general) hit
      512,
      ESCALATE,
      budget,
      approveTerminal,
    )
    expect(decision.approved.some(c => c.name === 'terminal')).toBe(true)
    expect(decision.approved.some(c => c.name === 'web_search')).toBe(false)
    expect(decision.rejected.some(c => c.name === 'web_search')).toBe(true)
    expect(decision.provenanceLine).toContain('approved=1')
  })

  it('DENY_ALL gate is the no-auto-add safety default', () => {
    const registry = registryWithAll()
    const budget: SelfExtensionBudget = { maxCandidates: 5, maxBudgetBytes: 4096 }
    const decision = guardExtension(
      registry,
      'run bash commands in a sandboxed shell',
      {}, // unrestricted base → the terminal slot is recovered as a candidate
      512,
      ESCALATE,
      budget,
      DENY_ALL,
    )
    // No candidate is auto-added; the addition plan is empty by default.
    expect(decision.approved).toEqual([])
    expect(decision.rejected.length).toBeGreaterThan(0)
  })

  it('never fabricates a rescue when every step misses (finite wall)', () => {
    const registry = registryWithAll()
    const budget: SelfExtensionBudget = { maxCandidates: 3, maxBudgetBytes: 4096 }
    const decision = guardExtension(
      registry,
      'zzzznonexistentcapabilityterm across any scope',
      { scope: 'tool' },
      512,
      ESCALATE,
      budget,
    )
    expect(decision.approved).toEqual([])
    expect(decision.rejected).toEqual([])
    expect(decision.budgetBytes).toBe(512) // the base budget, not a widened one
    expect(decision.provenanceLine).toContain('widen=noop')
  })
})

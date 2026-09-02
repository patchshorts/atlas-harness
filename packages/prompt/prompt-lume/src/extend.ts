/**
 * Capability acquisition surface (registry + lookup) for prompt-lume.
 *
 * The L4 self-extension seam: a small acquisition registry that watches
 * retrieval miss / capability gaps and can widen the hook or discover/attach
 * tools within a cost/quality budget. THIS module provides ONLY the
 * registry + lookup surface — the widen-hook fallback, budget, and guardrails
 * are separate tasks (T14/T15) and do NOT live here.
 *
 * Purely additive and deterministic: no LLM provider, no context, no global
 * state. A registry can be constructed directly with `new CapabilityRegistry()`
 * and consulted by the widening fallback later. Relevance scoring is a pure,
 * reproducible function (no models, no randomness), so lookup ordering is
 * stable across runs.
 *
 * @module
 */

/**
 * Scope classifier for a capability slot, matching the TurnSurface.kind
 * vocabulary in index.ts ('tool' | 'workspace' | 'identity' | 'general').
 * Lookup filters by scope so a workspace turn cannot surface identity-slotted
 * capabilities unless the requester asks for them explicitly.
 */
export type AcquisitionScope = 'tool' | 'workspace' | 'identity' | 'general'

/**
 * A named capability available for acquisition: what it does, which tool id it
 * exposes, which turn scope it serves, and where it came from.
 *
 * Written from the model's perspective — no UI or implementation vocabulary in
 * the public names; the slot is something the acquisition surface can hand back
 * as a candidate for a given turn.
 */
export interface CapabilitySlot {
  /** Short capability name, e.g. 'terminal' or 'web_search'. */
  name: string
  /** One-line human/model-readable description of what the capability offers. */
  summary: string
  /** The tool id the capability exposes (e.g. 'terminal', 'web_search'). */
  toolId: string
  /** Turn scope this capability serves; filters lookup when a scope is given. */
  scope: AcquisitionScope
  /** Provenance label describing who registered the slot / where it came from. */
  provenance: string
}

/**
 * A lookup result: a registered {@link CapabilitySlot} plus its deterministic
 * relevance score and a derived provenance line.
 */
export interface CapabilityCandidate extends CapabilitySlot {
  /** Relevance score in [0,1]; higher = more germane to the query. */
  score: number
  /**
   * Derived provenance line, e.g.
   * `[prompt-lume:acquisition] scope=tool score=1.000 src=self-modification`.
   */
  provenanceLine: string
}

/** Deterministic token-overlap (Jaccard) similarity between two token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection += 1
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** Split a string into lowercased, whitespace-delimited tokens (deterministic). */
function tokensOf(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter(Boolean))
}

/**
 * Deterministic relevance score for one capability slot against a query.
 *
 * Exact substring hits (on the capability name, then the summary) score
 * highest; otherwise token-overlap Jaccard over the name + summary governs.
 * The score is pure and reproducible — no model calls, no randomness — so
 * lookup ordering is stable across runs and a test may assert it.
 *
 * @returns a score in [0,1]; higher = more germane.
 */
export function scoreCapability(query: string, slot: CapabilitySlot): number {
  const q = query.toLowerCase().trim()
  if (q.length === 0) return 0
  const nameLower = slot.name.toLowerCase()
  const summaryLower = slot.summary.toLowerCase()
  // Exact substring hits dominate: name first, then summary.
  if (nameLower.includes(q)) return 1
  if (summaryLower.includes(q)) return 0.9
  // Otherwise token overlap (Jaccard) over name + summary tokens.
  const queryTokens = tokensOf(q)
  const slotTokens = new Set([...tokensOf(slot.name), ...tokensOf(slot.summary)])
  return jaccard(queryTokens, slotTokens)
}

/**
 * Derive the acquisition provenance line for a candidate.
 *
 * Stable model-visible text so the acquisition surface is attributable —
 * every returned candidate carries a `[prompt-lume:acquisition]` marker with
 * its scope, score, and slot provenance.
 */
export function provenanceLineFor(slot: CapabilitySlot, score: number): string {
  return `[prompt-lume:acquisition] scope=${slot.scope} score=${score.toFixed(3)} src=${slot.provenance}`
}

/** Options for a capability lookup. */
export interface LookupOptions {
  /**
   * Restrict candidates to slots of this scope. When omitted, all scopes are
   * eligible and the turn kind bounds the region rather than the lookup.
   */
  scope?: AcquisitionScope
  /** Max candidates to return. No cap when omitted. */
  limit?: number
}

/**
 * The acquisition registry.
 *
 * Construct with no required deps (`new CapabilityRegistry()`), register named
 * capability slots, and look up scoped, provenance-labeled candidates for a
 * query. Purely in-memory and effect-free at this stage — the widening
 * fallback (T14) decides when to consult it.
 */
export class CapabilityRegistry {
  private readonly slots: CapabilitySlot[] = []

  /** Register a capability slot for acquisition. Returns the registry (chainable). */
  register(slot: CapabilitySlot): this {
    this.slots.push(slot)
    return this
  }

  /** Total number of registered capability slots. */
  get size(): number {
    return this.slots.length
  }

  /**
   * Look up the most-germane capability candidates for a query.
   *
   * Filters by scope when one is given (a workspace-scoped lookup never
   * returns tool/identity-slotted slots), orders candidates by descending
   * relevance score (deterministic; ties break by name), attaches a derived
   * provenance line, and caps the result at `limit`.
   *
   * @returns scoped candidates with provenance; an empty array when nothing
   * matches (never undefined, never throws).
   */
  lookup(query: string, options: LookupOptions = {}): CapabilityCandidate[] {
    const scope = options.scope
    const limit = options.limit

    const scored: Array<{ slot: CapabilitySlot; score: number }> = []
    for (const slot of this.slots) {
      if (scope !== undefined && slot.scope !== scope) continue
      const score = scoreCapability(query, slot)
      if (score > 0) scored.push({ slot, score })
    }

    // Deterministic descending order: relevance first, then name as a stable
    // tiebreaker so two equal scores can never reorder across runs.
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.slot.name.localeCompare(b.slot.name)
    })

    return scored
      .slice(0, limit)
      .map(({ slot, score }) => ({
        ...slot,
        score,
        provenanceLine: provenanceLineFor(slot, score),
      }))
  }
}

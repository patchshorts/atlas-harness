/**
 * Workload-aware model routing (FrugalGPT cascade seam).
 *
 * The harness defaults every call to the cheap model and escalates to an
 * expensive model only when a certainty signal says the cheap result is not
 * trustworthy. No live judge hook exists yet — judge-gate carries ballots
 * only — so the signal is a typed input; wiring a real judge into this seam
 * is out of scope (the gate workstream owns it).
 *
 * Two call shapes exist. The legacy shape chooses directly between a cheap
 * and an expensive model on the certainty signal. The capability shape builds
 * an eligible chain from the caller's candidates and the configured
 * capability registry and rate table, then escalates that chain the same way
 * cascadeRoutes escalates any chain: certain/absent keeps the cheapest
 * eligible model, and uncertain moves one step up. When no candidate is both
 * capable and rated, the capability shape degrades to a cascade over the full
 * candidate list.
 *
 * @module @atlasai/atsh-llm/routing
 */

import { isCapable, type ModelCapabilityTable } from './cost/capability.ts'
import { type ModelRateTable } from './cost/rates.ts'
import { type TaskDomain } from './routing/domain.ts'

/** A caller's confidence in the cheap model's result for this request. */
export type CertaintySignal = 'certain' | 'uncertain'

export interface ResolveRouteOptions {
  /** The default model for this workload (usually the cheap one). */
  cheap: string
  /** The escalation model used when the cheap result is uncertain. */
  expensive: string
  /**
   * Confidence in the cheap result. Absent or 'certain' keeps the cheap
   * model; 'uncertain' escalates to the expensive model.
   */
  signal?: CertaintySignal
}

/** Capability-aware routing options. */
export interface CapabilityResolveRouteOptions {
  /** Candidate models the caller allows, cheapest first. */
  candidates: readonly string[]
  /** The routing domain the task belongs to. */
  domain: TaskDomain
  /**
   * Confidence in the cheapest result. Absent or 'certain' keeps the cheapest
   * eligible model; 'uncertain' escalates one step up the eligible chain.
   */
  signal?: CertaintySignal
  /** Configured capability registry; an unregistered model is not eligible. */
  registry: ModelCapabilityTable
  /** Configured per-model rates; an unrated model is not eligible. */
  rates: ModelRateTable
}

/**
 * Picks the model for one request.
 *
 * Two call shapes exist, discriminated by the options object. The legacy
 * shape chooses directly between a cheap and an expensive model on the
 * certainty signal. The capability shape builds an eligible chain from the
 * caller's candidates and the configured capability registry and rate
 * table, then escalates that chain the same way cascadeRoutes escalates any
 * chain: certain/absent keeps the cheapest eligible model, and uncertain
 * moves one step up. When no candidate is both capable and rated, the
 * capability shape degrades to a cascade over the full candidate list.
 */
export function resolveRoute(
  options: ResolveRouteOptions | CapabilityResolveRouteOptions,
): string {
  if ('candidates' in options) {
    const eligible = options.candidates.filter((model) => {
      const capability = options.registry[model]
      if (capability === undefined) {
        return false
      }
      if (options.domain !== 'simple' && !isCapable(capability, options.domain)) {
        return false
      }
      return options.rates[model] !== undefined
    })
    // An empty eligible chain degrades to a cascade over the full candidate
    // list; the caller falls back to the certainty ladder unchanged.
    const chain = eligible.length > 0 ? eligible : options.candidates
    return cascadeRoutes(chain, options.signal)
  }
  return options.signal === 'uncertain' ? options.expensive : options.cheap
}

/**
 * Escalation cascade over an ordered model chain (cheapest first).
 *
 * A certain (or absent) signal keeps the first model; an uncertain signal
 * moves one step up the chain. The last element is the ceiling: an uncertain
 * signal there stays put. An empty chain resolves to an empty string — there
 * is nothing to route to.
 */
export function cascadeRoutes(chain: readonly string[], signal?: CertaintySignal): string {
  const index = signal === 'uncertain' ? Math.min(1, chain.length - 1) : 0
  return chain[index] ?? ''
}

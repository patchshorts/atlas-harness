/**
 * Cheapest-capable model selector.
 *
 * Given the models a caller allows, a routing domain, a configured capability
 * registry, and a configured rate table, chooses the cheapest model that is
 * both capable of the domain and priced. Capability and pricing are
 * configured, never fabricated: a model that is unregistered, not capable of
 * the domain, or unrated is skipped with an explicit reason and can never
 * win. When no candidate is both capable and rated, the selector returns a
 * NULL selection (model `null`) rather than guessing — the cascade caller
 * (T4) escalates that to the certainty ladder.
 *
 * Selection is deterministic: candidates walk in the caller's given order,
 * and winners are the minimum (inputPerM, then outputPerM, then model name
 * via a locale-independent ASCII comparison). Equal-priced (inputPerM,
 * outputPerM) competitors resolve by lowest name, so repeated runs with the
 * same inputs return exactly the same result.
 *
 * Golden rule: cheapestCapable() is a pure function of (candidates, domain,
 * registry, rates). It holds no reference to any conversation or session
 * object, reads no model-visible history, and mutates nothing — it cannot
 * throw on empty candidates, an empty registry, or an empty rate table.
 *
 * @module @atlasai/atsh-llm/routing/selector
 */

import { isCapable, type ModelCapabilityTable } from '../cost/capability.ts'
import { type ModelRate, type ModelRateTable } from '../cost/rates.ts'
import { type TaskDomain } from './domain.ts'

/** Why one candidate did not win the selection. */
export type SelectorSkipReason = 'unknown' | 'not-capable' | 'unrated' | 'not-selected'

/** One skipped candidate and the reason it never won. */
export interface SelectorSkipRecord {
  /** The candidate model name. */
  readonly model: string
  /** Why the candidate was not selected. */
  readonly reason: SelectorSkipReason
}

/**
 * Result of a cheapest-capable selection.
 *
 * `model` is `null` when no candidate is both capable of the domain and rated
 * (the caller escalates that NULL selection to the cascade); `skipped` lists
 * every candidate that did not win, together with why — so a caller can tell
 * an unknown model from a capable-but-unrated one from a merely
 * more-expensive eligible one.
 */
export interface CheapestCapableResult {
  /** The selected model, or `null` when nothing eligible exists. */
  readonly model: string | null
  /** Every candidate that did not win, with the reason. */
  readonly skipped: ReadonlyArray<SelectorSkipRecord>
}

/**
 * Whether `contender` is strictly cheaper than `champion`.
 *
 * Prices are compared by the unit-cost proxy: inputPerM ascending, tied by
 * outputPerM ascending, and tied prices by the lower model name in an ASCII
 * (locale-independent) comparison so the ordering never varies between runs.
 */
function wins(
  contender: ModelRate,
  contenderName: string,
  champion: ModelRate,
  championName: string,
): boolean {
  if (contender.inputPerM !== champion.inputPerM) {
    return contender.inputPerM < champion.inputPerM
  }
  if (contender.outputPerM !== champion.outputPerM) {
    return contender.outputPerM < champion.outputPerM
  }
  return contenderName < championName
}

/**
 * Selects the cheapest candidate capable of `domain`.
 *
 * Walks `candidates` in the given order. A candidate is eligible when it is
 * registered, capable of the domain, and present in `rates`. Every candidate
 * that does not win is pushed onto `skipped` with its reason:
 * 'unknown' (not in the registry), 'not-capable' (unfit for the domain),
 * 'unrated' (capable but unpriceable), or 'not-selected' (eligible but not
 * cheapest). When nothing is eligible the result's `model` is `null` —
 * including the 'simple' domain with an empty registry — so the selector
 * never crashes.
 *
 * Capability-gate note: a 'simple' task trivially satisfies every domain, so
 * 'simple' applies NO capability gate — every registered model (whether its
 * benchmark bags are populated or not) competes on price alone. Only the four
 * benchmarked domains consult `isCapable`, and the task domain is coerced to
 * the narrower capability domain never widening the capability.ts types; the
 * 'simple' value never reaches `isCapable`.
 *
 * This function is a pure mapping of (candidates, domain, registry, rates) to
 * a fresh result object: it reads no state and mutates nothing, so callers
 * may rely on it being deterministic and reusable.
 */
export function cheapestCapable(
  candidates: readonly string[],
  domain: TaskDomain,
  registry: ModelCapabilityTable,
  rates: ModelRateTable,
): CheapestCapableResult {
  const skipped: SelectorSkipRecord[] = []
  let winner: { readonly model: string; readonly rate: ModelRate } | null = null
  for (const model of candidates) {
    const capability = registry[model]
    if (capability === undefined) {
      skipped.push({ model, reason: 'unknown' })
      continue
    }
    const capable = domain === 'simple' || isCapable(capability, domain)
    if (!capable) {
      skipped.push({ model, reason: 'not-capable' })
      continue
    }
    const rate = rates[model]
    if (rate === undefined) {
      skipped.push({ model, reason: 'unrated' })
      continue
    }
    if (winner === null) {
      winner = { model, rate }
      continue
    }
    if (wins(rate, model, winner.rate, winner.model)) {
      skipped.push({ model: winner.model, reason: 'not-selected' })
      winner = { model, rate }
      continue
    }
    skipped.push({ model, reason: 'not-selected' })
  }
  return { model: winner?.model ?? null, skipped }
}

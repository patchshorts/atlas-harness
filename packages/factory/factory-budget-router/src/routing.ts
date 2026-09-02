// Pure routing for the budget router — no I/O, no `this`.
//
// T6 adds CUMULATIVE-COST-CONDITIONED routing on top of the router service's
// per-capability STATIC routing: a per-stage tier ladder whose tier choice
// depends on cumulative spend, with the router's routeState vocabulary and
// frozen-request semantics preserved exactly (never mutate a frozen request).

import type { BudgetRouteState, StageRoute } from './types.ts'

/**
 * Select the active tier of a ladder for a cumulative cost.
 *
 * Tiers are sorted ascending by `maxCumulativeCost`; the FIRST tier whose
 * bound is `undefined` OR `>= cumulativeCost` wins — the tiers form a
 * fallback ladder: while cumulative spend is within a bound the
 * corresponding tier applies, and once spend exceeds every bound the last
 * (cheapest, unbounded) tier applies. Empty ladder → `undefined`.
 *
 * @param ladder - the tier ladder, ascending `maxCumulativeCost`.
 * @param cumulativeCost - cumulative spend for the account/stage.
 * @returns the selected tier, or `undefined` for an empty ladder.
 */
export function selectTier(ladder: StageRoute[], cumulativeCost: number): StageRoute | undefined {
  for (const tier of ladder) {
    if (tier.maxCumulativeCost === undefined || tier.maxCumulativeCost >= cumulativeCost) {
      return tier
    }
  }
  return undefined
}

/**
 * Resolve the route for a stage at a cumulative cost.
 *
 * @param stage - the stage key ('general', ...).
 * @param cumulativeCost - cumulative spend for the account/stage.
 * @param stageRoutes - stage -> tier ladder map.
 * @returns the selected tier, or `undefined` when the stage has no entry.
 */
export function routeForStage(
  stage: string,
  cumulativeCost: number,
  stageRoutes: Record<string, StageRoute[]>,
): StageRoute | undefined {
  const ladder = stageRoutes[stage]
  return ladder === undefined ? undefined : selectTier(ladder, cumulativeCost)
}

/**
 * Match a request against a resolved route with the router's semantics.
 *
 * Same pair → 'matched'; different pair + `!frozen && applyRoutes` →
 * 'rewritten' (resolved = route); different pair + (`frozen` || `!applyRoutes`)
 * → 'advisory' (resolved = REQUESTED — never mutate a frozen request).
 *
 * @param requestedProvider - the requested provider.
 * @param requestedModel - the requested model.
 * @param route - the resolved route tier.
 * @param frozen - whether the request options object is frozen.
 * @param applyRoutes - whether route rewrites are enabled.
 * @returns the resolution: resolved provider/model + the route state.
 */
export function matchRoute(
  requestedProvider: string,
  requestedModel: string,
  route: StageRoute,
  frozen: boolean,
  applyRoutes: boolean,
): { resolvedProvider: string; resolvedModel: string; routeState: BudgetRouteState } {
  if (route.provider === requestedProvider && route.model === requestedModel) {
    return { resolvedProvider: requestedProvider, resolvedModel: requestedModel, routeState: 'matched' }
  }
  if (!frozen && applyRoutes) {
    return { resolvedProvider: route.provider, resolvedModel: route.model, routeState: 'rewritten' }
  }
  return { resolvedProvider: requestedProvider, resolvedModel: requestedModel, routeState: 'advisory' }
}

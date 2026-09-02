// Pure batch planning for the budget router — no I/O, no `this`.
//
// Batch prompting groups requests that share the SAME system prompt so the
// shared prefix is billed as one cache entry. Planning never reads message
// bodies (they are opaque), and the plan is deterministic and stable.

import type { BatchGroup, BatchPlan, BatchRequest } from './types.ts'

/**
 * Estimate the tokens of a system prompt (mirrors token-meter
 * CHARS_PER_TOKEN = 4).
 *
 * @param system - the system prompt, or `null` for no system prompt.
 * @returns `Math.ceil(system.length / 4)`, or 0 for `null`.
 */
export function estimateSystemTokens(system: string | null): number {
  return system ? Math.ceil(system.length / 4) : 0
}

/**
 * Group requests by identical system prompt into a batch plan.
 *
 * @param requests - the requests to group; only `system` is read.
 * @returns groups in insertion order (null-system requests group together)
 *   plus the estimated cache-read savings: sum over groups of
 *   (group size - 1) * sharedPrefixTokens.
 */
export function planBatches(requests: BatchRequest[]): BatchPlan {
  const groups: BatchGroup[] = []
  const bySystem = new Map<string | null, BatchGroup>()
  for (let index = 0; index < requests.length; index += 1) {
    const system = requests[index]?.system ?? null
    let group = bySystem.get(system)
    if (group === undefined) {
      group = { system, requestIndexes: [], sharedPrefixTokens: estimateSystemTokens(system) }
      bySystem.set(system, group)
      groups.push(group)
    }
    group.requestIndexes.push(index)
  }
  const cacheReadSavingsTokens = groups.reduce(
    (sum, group) => sum + (group.requestIndexes.length - 1) * group.sharedPrefixTokens,
    0,
  )
  return { groups, cacheReadSavingsTokens }
}

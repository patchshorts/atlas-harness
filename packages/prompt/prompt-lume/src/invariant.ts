/**
 * Package-owned invariant companion for `@atlasai/atsh-prompt-lume`.
 * @module @atlasai/atsh-prompt-lume/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@atlasai/atsh-invariants'
import type { PromptLumeCostRecord } from './cost.ts'

const PACKAGE_NAME = '@atlasai/atsh-prompt-lume'

/** Cordis companion plugin name. */
export const name = 'prompt-lume-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Runtime invariant: the first emitted cost record is always a cache miss.
 *
 * `prompt-lume/cost` cache-hit means the byte-stable core was identical to the
 * previous call's core — impossible without a prior call. The sidecar
 * guarantees callCount is monotonic starting at 1, so a record with
 * `cacheHit === true` and `callCount === 1` violates the relation.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('prompt-lume/cost', (record: PromptLumeCostRecord) => {
    if (record.cacheHit && record.callCount <= 1) {
      fail('prompt-lume/cost cache-hit on the first call is impossible (core has no prior call to match)')
    }
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

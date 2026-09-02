/**
 * Package-owned invariant companion for `@atlasai/atsh-runtime-events`.
 * @module @atlasai/atsh-runtime-events/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-runtime-events'

/** Cordis companion plugin name. */
export const name = 'runtime-events-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant at scaffold time: the append/replay relationship is
 * asserted by the event-stream service's own test suite (T2+T3). The companion
 * reserves package ownership now; the service-level check is authored with the
 * stream core it guards. (No runtime invariant: ownership is the only mutation
 * this companion introduces.)
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

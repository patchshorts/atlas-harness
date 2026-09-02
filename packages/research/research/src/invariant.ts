/**
 * Package-owned invariant companion for `@atlasai/atsh-research`.
 * @module @atlasai/atsh-research/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-research'

/** Cordis companion plugin name. */
export const name = 'research-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: per-source counter accounting and disabled/ENOENT
 * degradation are asserted in the package's own tests; duplicate
 * `ctx.research` registration is cordis' standard service guard, and the
 * xurl/arXiv seams are external by design.
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

/**
 * Package-owned invariant companion for `@atlasai/atsh-tool-kgraph`.
 * @module @atlasai/atsh-tool-kgraph/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-tool-kgraph'

/** Cordis companion plugin name. */
export const name = 'tool-kgraph-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: tool registration uniqueness and disposal are owned
 * by the tool registry; `ctx.kgraph` presence is enforced by the
 * plugin's `inject` list, not by this package.
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

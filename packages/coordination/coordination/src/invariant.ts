/**
 * Package-owned invariant companion for `@atlasai/atsh-coordination`.
 * @module @atlasai/atsh-coordination/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-coordination'

/** Cordis companion plugin name. */
export const name = 'coordination-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the worker registry ↔ subagent run relationship and
 * shared-state rows are asserted in the package's own tests; duplicate
 * `ctx.coordination` registration is cordis' standard service guard.
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

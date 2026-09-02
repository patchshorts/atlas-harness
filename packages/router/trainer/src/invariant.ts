/**
 * Package-owned invariant companion for `@atlasai/atsh-router-trainer`.
 * @module @atlasai/atsh-router-trainer/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-router-trainer'

/** Cordis companion plugin name. */
export const name = 'router-trainer-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the `router/call-logged` → sample-queue relationship is checked
 * in the package's own tests, and `ctx.routerTrainer` composition is a documented
 * plugin responsibility.
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

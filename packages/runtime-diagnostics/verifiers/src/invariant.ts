/**
 * Package-owned invariant companion for `@atlasai/atsh-runtime-verifiers`.
 * @module @atlasai/atsh-runtime-verifiers/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-runtime-verifiers'

/** Cordis companion plugin name. */
export const name = 'runtime-verifiers-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the verifiers' purity, TNR guard, and truth-gate
 * contracts are asserted by the package's own test suite (T7). The companion
 * reserves package ownership now; the service-level check is authored with the
 * hardening behavior it guards. (No runtime invariant: ownership is the only
 * mutation this companion introduces.)
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

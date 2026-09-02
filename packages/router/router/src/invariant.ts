/**
 * Package-owned invariant companion for `@atlasai/atsh-router`.
 * @module @atlasai/atsh-router/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-router'

/** Cordis companion plugin name. */
export const name = 'router-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the call-log row ↔ `router/call-logged` record relationship is
 * checked in the package's own tests (and by the trainer's consumption test), and
 * duplicate `ctx.llmRouter` registration is cordis' standard service guard.
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

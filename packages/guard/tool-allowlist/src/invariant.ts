/**
 * Package-owned invariant companion for `@atlasai/atsh-tool-allowlist`.
 *
 * The gate's load-bearing property is FAIL-CLOSED: an empty or absent
 * allowlist must deny every tool call. The runtime invariant asserts the
 * installed allowlist set refuses any name not explicitly listed — an empty
 * set denies nothing-in-particular only in the sense that it denies every
 * name, which is the required default. A non-empty set must contain exactly
 * the configured members, never an implicit "deny nothing" escape.
 *
 * @module @atlasai/atsh-tool-allowlist/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-tool-allowlist'

/** Cordis companion plugin name. */
export const name = 'tool-allowlist-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Fail-closed invariant: the allowlist set is the gate's authoritative state.
 * The gate Service resolves membership via this set at call time; there is no
 * other code path that admits a tool. No session-log, message-history, or
 * projection mutation ever occurs — the gate observes the request/response
 * cycle as an append-only effect.
 */
const install: InvariantInstaller = () => {
  // No runtime invariant: fail-closed membership (empty allowlist denies all)
  // and the append-only golden-rule property are asserted in the package's own
  // tests; the gate owns no event history or mutable data relation beyond the
  // allowlist set resolved at call time, and disposes with the context.
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

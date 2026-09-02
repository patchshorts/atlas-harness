/**
 * Package invariant companion for `@atlasai/atsh-bench`.
 *
 * The bench classifier is a pure deterministic function over exported
 * session-log JSON; the runner and reporter lifecycle pairs arrive with
 * T5/T6. The classifier's only structural contract is already enforced by
 * its types (input = `SessionEvent` envelope) and unit tests — there is no
 * runtime-invariant relation to assert until the runner exists.
 *
 * @module @atlasai/atsh-bench/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-bench'

export const name = 'bench-invariant'
export const inject = ['invariants']

/** No runtime invariant: the classifier is a pure function; lifecycle pairs land with T5/T6. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Host context carrying the invariant registry.
 * @returns the registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

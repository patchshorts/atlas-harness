// factory-judge-invariant: the invariant companion for @atlasai/atsh-factory-judge.
// No runtime invariant: judge rules and vote aggregation are asserted in the
// package's own tests; ballot and replan state are in-memory and disposed with
// the context.

import { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-factory-judge'

export const name = 'factory-judge-invariant'

export const inject = ['invariants']

/* jscpd:ignore-start */
const install: InvariantInstaller = () => {
  // No runtime invariant: judge rules and vote aggregation are asserted
  // in the package's own tests; ballot and replan state are in-memory and
  // disposed with the context.
}

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
/* jscpd:ignore-end */

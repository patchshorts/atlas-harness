// factory-invariant: the invariant companion for @atlasai/atsh-factory.
// No runtime invariant: scoring rules and contract validation are asserted in
// the package's own tests; the contract registry is in-memory and disposed
// with the context.

import { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-factory'

export const name = 'factory-invariant'

export const inject = ['invariants']

/* jscpd:ignore-start */
const install: InvariantInstaller = () => {
  // No runtime invariant: scoring rules and contract validation are asserted
  // in the package's own tests; the contract registry is in-memory and
  // disposed with the context.
}

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
/* jscpd:ignore-end */

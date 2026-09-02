// factory-budget-router-invariant: the invariant companion for @atlasai/atsh-factory-budget-router.
// No runtime invariant: budget enforcement reads accounting's ledger; routing
// and batch planning are pure functions; the service holds no model-visible
// state — asserted in the package's own tests.

import { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-factory-budget-router'

export const name = 'factory-budget-router-invariant'

export const inject = ['invariants']

/* jscpd:ignore-start */
const install: InvariantInstaller = () => {
  // No runtime invariant: budget enforcement reads accounting's ledger;
  // routing and batch planning are pure functions; the service holds no
  // model-visible state — asserted in the package's own tests.
}

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
/* jscpd:ignore-end */

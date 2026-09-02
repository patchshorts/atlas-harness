// tool-factory-invariant: the invariant companion for
// @atlasai/atsh-tool-factory.
// No runtime invariant: the tools are thin model-facing adapters over
// ctx.factory, whose scoring rules and contract validation are asserted in
// the package's own tests; no external resources are owned.

import { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-tool-factory'

export const name = 'tool-factory-invariant'

export const inject = ['invariants']

/* jscpd:ignore-start */
const install: InvariantInstaller = () => {
  // No runtime invariant: the tools are thin adapters over ctx.factory, whose
  // scoring rules and contract validation are asserted in the package's own
  // tests; no external resources are owned.
}

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
/* jscpd:ignore-end */

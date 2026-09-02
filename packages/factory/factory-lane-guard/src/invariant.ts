// factory-lane-guard-invariant: the invariant companion for @atlasai/atsh-factory-lane-guard.
// No runtime invariant: the allowlist gate is registered against the tools
// guard layer; channel marking, sanitization, and taint verification are
// pure derived passes — the package never writes to the session log or
// message history (golden rule), asserted in the package's own tests.

import { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-factory-lane-guard'

export const name = 'factory-lane-guard-invariant'

export const inject = ['invariants']

/* jscpd:ignore-start */
const install: InvariantInstaller = () => {
  // No runtime invariant: the allowlist gate is registered against the tools
  // guard layer; channel marking, sanitization, and taint verification are
  // pure derived passes — the package never writes to the session log or
  // message history (golden rule), asserted in the package's own tests.
}

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
/* jscpd:ignore-end */

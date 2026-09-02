// session-context-debt-invariant: the invariant companion for
// @atlasai/atsh-session-context-debt.
// No runtime invariant: the fold is stateless and the JSONL log is the only
// state — and this service never writes it. Fold correctness and the
// byte-identical-log guarantee are asserted in the package's own tests.

import { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-session-context-debt'

export const name = 'session-context-debt-invariant'

export const inject = ['invariants']

/* jscpd:ignore-start */
const install: InvariantInstaller = () => {
  // No runtime invariant: the fold is stateless and the JSONL log is the only
  // state — and this service never writes it. Fold correctness and the
  // byte-identical-log guarantee are asserted in the package's own tests.
}

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
/* jscpd:ignore-end */

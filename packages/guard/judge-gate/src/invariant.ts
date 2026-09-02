// judge-gate-invariant: the invariant companion for @atlasai/atsh-judge-gate.
// No runtime invariant: the gate is a seam over ctx.factoryJudge — parse
// determinism and fail-closed rejection are asserted in the package's own
// tests; the gate owns no state of its own and disposes with the context.

import { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-judge-gate'

export const name = 'judge-gate-invariant'

export const inject = ['invariants']

/* jscpd:ignore-start */
const install: InvariantInstaller = () => {
  // No runtime invariant: the gate is a seam over ctx.factoryJudge. Parse
  // determinism (same markdown → same tasks) and fail-closed rejection are
  // asserted in the package's own tests; the gate owns no state of its own
  // and disposes with the context.
}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

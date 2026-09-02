// factory-observability-invariant: the invariant companion for
// @atlasai/atsh-factory-observability.
// No runtime invariant: the event stream metrics, predictive failure signals,
// completion verification, and replay-with-patch are pure derived passes over
// an in-memory append-only window; the package never writes to the session
// log or message history (golden rule), asserted in the package's own tests.

import { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@atlasai/atsh-invariants'

const PACKAGE_NAME = '@atlasai/atsh-factory-observability'

export const name = 'factory-observability-invariant'

export const inject = ['invariants']

/* jscpd:ignore-start */
const install: InvariantInstaller = () => {
  // No runtime invariant: the event stream metrics, predictive failure
  // signals, completion verification, and replay-with-patch are pure derived
  // passes over an in-memory append-only window; the package never writes to
  // the session log or message history (golden rule), asserted in the
  // package's own tests.
}

export function apply(ctx: Context): Promise<() => void> {
  return Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
}
/* jscpd:ignore-end */

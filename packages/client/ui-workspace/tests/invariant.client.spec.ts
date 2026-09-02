import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as WorkspaceInvariant from '@atlasai/atsh-client-ui-workspace/invariant'
import InvariantRegistry from '@atlasai/atsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(WorkspaceInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', async () => {
    const { apply } = await import('@atlasai/atsh-client-ui-workspace')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})

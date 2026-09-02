import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as SchemaFormInvariant from '@atlasai/atsh-client-schema-form/invariant'
import InvariantRegistry from '@atlasai/atsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(SchemaFormInvariant).await()).resolves.toBeDefined()
  })
})

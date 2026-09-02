/**
 * Unit coverage for @atlasai/atsh-tool-research: both tools register on
 * `ctx.tools`, and tool calls degrade to empty results when the research
 * service is disabled (the tools still register; only lookups short-circuit).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@atlasai/atsh-llm'
import SystemPrompt from '@atlasai/atsh-system-prompt'
import ToolRuntime from '@atlasai/atsh-tools'
// The research plugin is imported by relative source path: the workspace glob for
// the new `research` group is not (yet) in tsconfig.base.json's dsh-* path map, so
// package-name resolution would fall through to an unbuilt lib/. Relative is
// deliberate and additive.
import ResearchService from '../../research/src/index.ts'
import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** Mount the real plugin body: system prompt, tool runtime, disabled research service, and the tools. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ResearchService, { enabled: false })
  await ctx.plugin(tool, {})
  return ctx
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
  })
}

describe('dsh-tool-research', () => {
  it('registers xurl_search and arxiv_search on ctx.tools', async () => {
    const ctx = await setup()
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('xurl_search')
    expect(names).toContain('arxiv_search')
    await ctx.fiber.dispose()
  })

  it('xurl_search returns { posts: [] } when the research service is disabled', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'xurl_search', { query: 'anything' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected xurl_search success')
    expect((result.value as { posts: unknown[] }).posts).toEqual([])
    await ctx.fiber.dispose()
  })
})

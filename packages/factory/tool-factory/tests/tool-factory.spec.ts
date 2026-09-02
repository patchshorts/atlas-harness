/**
 * Unit coverage for @atlasai/atsh-tool-factory: both tools register on
 * `ctx.tools`, bar_critic scores a submission against a real registered plan
 * contract (PASS and FAIL paths), and contract_status lists the contract or
 * errors on an unknown plan id.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@atlasai/atsh-llm'
import SystemPrompt from '@atlasai/atsh-system-prompt'
import ToolRuntime from '@atlasai/atsh-tools'
// The factory service is imported by relative source path: the workspace glob
// for the new `factory` group is not (yet) in tsconfig.base.json's dsh-* path
// map, so package-name resolution would fall through to an unbuilt lib/.
// Relative is deliberate and additive (tool-research precedent).
import FactoryService from '../../factory/src/index.ts'
import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** Mount the real plugin body: system prompt, tool runtime, factory service, and the tools. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FactoryService, {})
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

describe('dsh-tool-factory', () => {
  it('registers bar_critic and contract_status on ctx.tools', async () => {
    const ctx = await setup()
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('bar_critic')
    expect(names).toContain('contract_status')
    await ctx.fiber.dispose()
  })

  it('bar_critic returns a PASS verdict for a valid submission against a registered contract', async () => {
    const ctx = await setup()
    ctx.factory.registerPlanContract('p1', [
      { id: 'T14', verb: 'add', object: 'packages/factory', verifies: 'package builds and tests pass' },
    ])
    const result = await call(ctx, 'bar_critic', {
      planId: 'p1',
      taskId: 'T14',
      summary: 'Landed the factory package',
      evidence: ['vitest 9/9', 'tsc -b exit 0'],
      files: ['packages/factory/factory/src/service.ts'],
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected bar_critic success')
    expect((result.value as { verdict: { status: string } }).verdict.status).toBe('PASS')
    await ctx.fiber.dispose()
  })

  it('bar_critic returns a FAIL verdict for an empty-evidence submission', async () => {
    const ctx = await setup()
    ctx.factory.registerPlanContract('p1', [
      { id: 'T14', verb: 'add', object: 'packages/factory', verifies: 'package builds and tests pass' },
    ])
    const result = await call(ctx, 'bar_critic', {
      planId: 'p1',
      taskId: 'T14',
      summary: 'Landed the factory package',
      evidence: [],
      files: ['packages/factory/factory/src/service.ts'],
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected bar_critic success')
    const value = result.value as { verdict: { status: string; reasons: string[] } }
    expect(value.verdict.status).toBe('FAIL')
    expect(value.verdict.reasons).toEqual(['evidence must be a non-empty array of normalized strings'])
    await ctx.fiber.dispose()
  })

  it('contract_status lists the registered tasks of a plan contract', async () => {
    const ctx = await setup()
    ctx.factory.registerPlanContract('p1', [
      { id: 'T14', verb: 'add', object: 'packages/factory', verifies: 'package builds and tests pass' },
      { id: 'T15', verb: 'compose', object: 'preset rows', verifies: 'ADDED lines only' },
    ])
    const result = await call(ctx, 'contract_status', { planId: 'p1' })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected contract_status success')
    const value = result.value as { planId: string; tasks: Array<{ id: string }> }
    expect(value.planId).toBe('p1')
    expect(value.tasks.map(t => t.id)).toEqual(['T14', 'T15'])
    await ctx.fiber.dispose()
  })

  it('contract_status errors on an unknown plan id', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'contract_status', { planId: 'nope' })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('expected contract_status error')
    const message = (result.error as { message?: string }).message
      ?? JSON.stringify(result.error)
    expect(message).toContain('unknown plan contract "nope"')
    await ctx.fiber.dispose()
  })
})

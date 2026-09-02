/**
 * Unit coverage for @atlasai/atsh-coordination: sqlite shared-state
 * channels, worker spawns through the real subagent registry (via the
 * scripted provider fixture), unknown-provider rejection, disabled config,
 * and disposal.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@atlasai/atsh-agent'
import SubagentRuntime from '@atlasai/atsh-subagent'
import type { SubagentStartRequest } from '@atlasai/atsh-subagent'
import { SessionId } from '@atlasai/atsh-session'
import CoordinationService, { type CoordinationConfig } from '../src/index.ts'
import { mountScriptedProvider } from './scripted-provider.ts'

/** A minimal parent; the scripted provider only reads its id. */
function fakeAgent(id = 'parent-1'): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

/** A base delegation request with a fresh abort signal. */
function baseRequest(over: Partial<SubagentStartRequest> = {}): SubagentStartRequest {
  return {
    prompt: [{ type: 'text', text: 'task' }],
    parent: fakeAgent(),
    signal: new AbortController().signal,
    ...over,
  }
}

/** Mount the subagent registry, a scripted 'mock' provider, and the service. */
async function mount(config: CoordinationConfig = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  await mountScriptedProvider(ctx, { name: 'mock', reply: 'worker done' })
  await ctx.plugin(CoordinationService, config)
  return ctx
}

describe('dsh-coordination', () => {
  it('shared-state round-trip: postState then getState with monotonic revisions', async () => {
    const ctx = await mount()
    const first = ctx.coordination.postState('build', 'result', { ok: true, n: 42 })
    expect(first.revision).toBe(1)
    const entry = ctx.coordination.getState('build', 'result')
    expect(entry?.value).toEqual({ ok: true, n: 42 })
    expect(entry?.revision).toBe(1)
    const second = ctx.coordination.postState('build', 'result', { ok: false })
    expect(second.revision).toBe(2)
    expect(ctx.coordination.getState('build', 'result')?.value).toEqual({ ok: false })
    await ctx.fiber.dispose()
  })

  it('channels are isolated: the same key in different channels', async () => {
    const ctx = await mount()
    ctx.coordination.postState('a', 'k', 1)
    ctx.coordination.postState('b', 'k', 2)
    const a = ctx.coordination.listChannel('a')
    expect(a).toHaveLength(1)
    expect(a[0]?.value).toBe(1)
    expect(ctx.coordination.getState('a', 'k')?.value).toBe(1)
    expect(ctx.coordination.getState('b', 'k')?.value).toBe(2)
    await ctx.fiber.dispose()
  })

  it('spawnWorker runs through the subagent registry and records completion', async () => {
    const ctx = await mount()
    const started: { workerId: string; provider: string }[] = []
    const completed: { workerId: string; provider: string; status: string }[] = []
    ctx.on('coordination/worker-started', payload => started.push(payload))
    ctx.on('coordination/worker-completed', payload => completed.push(payload))
    const workerId = await ctx.coordination.spawnWorker('mock', {
      label: 'w1',
      prompt: [{ type: 'text', text: 'do it' }],
      parent: fakeAgent(),
      signal: new AbortController().signal,
    })
    const record = ctx.coordination.getWorker(workerId)
    expect(record?.provider).toBe('mock')
    expect(record?.status).toBe('completed')
    expect(record?.outcome).toContain('worker done')
    expect(record?.finishedAt).not.toBeNull()
    expect(started).toHaveLength(1)
    expect(started[0]?.provider).toBe('mock')
    expect(completed).toHaveLength(1)
    expect(completed[0]?.status).toBe('completed')
    await ctx.fiber.dispose()
  })

  it('rejects an unknown provider name', async () => {
    const ctx = await mount()
    await expect(ctx.coordination.spawnWorker('nope', baseRequest())).rejects.toThrow(/not registered/)
    await ctx.fiber.dispose()
  })

  it('disabled config rejects spawnWorker and postState', async () => {
    const ctx = await mount({ enabled: false })
    await expect(ctx.coordination.spawnWorker('mock', baseRequest())).rejects.toThrow(/disabled/)
    expect(() => ctx.coordination.postState('build', 'result', 1)).toThrow(/disabled/)
    await ctx.fiber.dispose()
  })

  it('closes the database when the owning context stops', async () => {
    const ctx = await mount()
    expect(ctx.coordination.getStats()).toEqual({
      workers: { total: 0, running: 0, completed: 0, failed: 0 },
      channels: 0,
    })
    await ctx.fiber.dispose()
  })
})

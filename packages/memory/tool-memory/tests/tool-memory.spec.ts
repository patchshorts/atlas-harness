import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@atlasai/atsh-llm'
import SystemPrompt from '@atlasai/atsh-system-prompt'
import ToolRuntime from '@atlasai/atsh-tools'
// The memory plugin is imported by relative source path: the workspace glob for the new
// `memory` group is not (yet) in tsconfig.base.json's dsh-* path map, so package-name
// resolution would fall through to an unbuilt lib/. Relative is deliberate and additive.
import * as memory from '../../memory/src/index.ts'
import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** Mount the real plugin body: system prompt, tool runtime, sqlite memory, and the tools. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
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

describe('dsh-tool-memory', () => {
  it('registers memory_recall, memory_get, memory_list, memory_retain, and memory_reflect on ctx.tools', async () => {
    const ctx = await setup()
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('memory_recall')
    expect(names).toContain('memory_get')
    expect(names).toContain('memory_list')
    expect(names).toContain('memory_retain')
    expect(names).toContain('memory_reflect')
  })

  it('memory_get retrieves a retained fact byte-exactly and reports found:false for a miss', async () => {
    const ctx = await setup()
    await call(ctx, 'memory_retain', { content: 'color=blue' })
    const hit = await call(ctx, 'memory_get', { key: 'color=blue' })
    expect(hit.isError).toBe(false)
    if (hit.isError) throw new Error('expected memory_get success')
    expect((hit.value as { found: boolean; record: { content: string } }).found).toBe(true)
    expect((hit.value as { record: { content: string } }).record.content).toBe('color=blue')
    const miss = await call(ctx, 'memory_get', { key: 'color=green' })
    expect(miss.isError).toBe(false)
    if (miss.isError) throw new Error('expected memory_get miss success')
    expect((miss.value as { found: boolean }).found).toBe(false)
  })

  it('memory_list returns all 40 retained facts byte-exact with no cap (37-exact-recovery shape)', async () => {
    const ctx = await setup()
    // Store 40 hrd-02-style key/value pairs via the retain tool (one per call).
    for (let i = 0; i < 40; i++) {
      const content = `hd-key-${String(i).padStart(2, '0')}=value-${i}`
      const retain = await call(ctx, 'memory_retain', { content, namespace: 'hrd02' })
      expect(retain.isError).toBe(false)
      if (retain.isError) throw new Error('expected memory_retain success')
    }
    const listed = await call(ctx, 'memory_list', { namespace: 'hrd02' })
    expect(listed.isError).toBe(false)
    if (listed.isError) throw new Error('expected memory_list success')
    const value = listed.value as { count: number; records: { content: string; namespace: string }[] }
    expect(value.count).toBe(40)
    expect(value.records).toHaveLength(40)
    const contents = new Set(value.records.map(r => r.content))
    expect(contents.has('hd-key-00=value-0')).toBe(true)
    expect(contents.has('hd-key-39=value-39')).toBe(true)
    expect(value.records.every(r => r.namespace === 'hrd02')).toBe(true)
  })

  it('memory_retain batch items stores 40 facts in one batch call and memory_list returns all 40 byte-exact', async () => {
    const ctx = await setup()
    // Store 40 hrd-02-style key/value pairs via ONE batch retain call (content form keeps working separately).
    const items = Array.from({ length: 40 }, (_, i) => ({
      content: `hd-key-${String(i).padStart(2, '0')}=batch-${i}`,
      namespace: 'hrd02-batch',
    }))
    const batch = await call(ctx, 'memory_retain', { items })
    expect(batch.isError).toBe(false)
    if (batch.isError) throw new Error('expected batch memory_retain success')
    const batchValue = batch.value as { ids: string[]; count: number }
    expect(batchValue.count).toBe(40)
    expect(batchValue.ids).toHaveLength(40)
    const listed = await call(ctx, 'memory_list', { namespace: 'hrd02-batch' })
    expect(listed.isError).toBe(false)
    if (listed.isError) throw new Error('expected memory_list success')
    const value = listed.value as { count: number; records: { content: string; namespace: string }[] }
    expect(value.count).toBe(40)
    expect(value.records).toHaveLength(40)
    const contents = new Set(value.records.map(r => r.content))
    expect(contents.has('hd-key-00=batch-0')).toBe(true)
    expect(contents.has('hd-key-39=batch-39')).toBe(true)
    expect(value.records.every(r => r.namespace === 'hrd02-batch')).toBe(true)
  })

  it('memory_retain content form still works unchanged and rejects neither/both', async () => {
    const ctx = await setup()
    const single = await call(ctx, 'memory_retain', { content: 'round-trip bootstraps fine' })
    expect(single.isError).toBe(false)
    if (single.isError) throw new Error('expected single memory_retain success')
    const neither = await call(ctx, 'memory_retain', {})
    expect(neither.isError).toBe(true)
    const both = await call(ctx, 'memory_retain', { content: 'x', items: [{ content: 'y' }] })
    expect(both.isError).toBe(true)
  })

  it('round-trips a retained memory through memory_retain and memory_recall', async () => {
    const ctx = await setup()
    const retain = await call(ctx, 'memory_retain', { content: 'the user prefers dark mode' })
    expect(retain.isError).toBe(false)
    if (retain.isError) throw new Error('expected memory_retain success')
    const id = (retain.value as { id: string }).id
    expect(id).toBeTruthy()

    const recall = await call(ctx, 'memory_recall', { query: 'dark mode preference' })
    expect(recall.isError).toBe(false)
    if (recall.isError) throw new Error('expected memory_recall success')
    const results = (recall.value as { results: { content: string; score: number }[] }).results
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.content).toBe('the user prefers dark mode')
    expect(results[0]!.score).toBeGreaterThan(0)
  })

  it('memory_reflect reports totals, namespace distribution, and recent entries', async () => {
    const ctx = await setup()
    await call(ctx, 'memory_retain', { content: 'alpha', namespace: 'work' })
    await call(ctx, 'memory_retain', { content: 'beta' })
    const reflect = await call(ctx, 'memory_reflect', {})
    expect(reflect.isError).toBe(false)
    if (reflect.isError) throw new Error('expected memory_reflect success')
    const value = reflect.value as {
      total: number
      byNamespace: Record<string, number>
      recent: { content: string }[]
    }
    expect(value.total).toBe(2)
    expect(value.byNamespace).toEqual({ work: 1, '': 1 })
    expect(value.recent).toHaveLength(2)
  })

  it('memory_recall scopes to a namespace and skips other namespaces', async () => {
    const ctx = await setup()
    await call(ctx, 'memory_retain', { content: 'private detail', namespace: 'private' })
    const scoped = await call(ctx, 'memory_recall', { query: 'private detail', namespace: 'public' })
    expect(scoped.isError).toBe(false)
    if (scoped.isError) throw new Error('expected memory_recall success')
    expect((scoped.value as { results: unknown[] }).results).toHaveLength(0)
  })

  it('rejects a memory_recall call missing the required query (schema boundary)', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'memory_recall', {})
    expect(result.isError).toBe(true)
  })

  it('unregisters the tools when its contributing fiber is disposed (HMR-safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
    const fiber = await ctx.plugin(tool, {})
    expect(ctx.tools.schemas().some(s => s.name === 'memory_recall')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'memory_recall')).toBe(false)
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-memory')
    expect(tool.inject).toEqual(['tools', 'memoryStore'])
    expect(typeof tool.apply).toBe('function')
  })
})

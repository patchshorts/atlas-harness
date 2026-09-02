import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memory from '../src/index.ts'
import { PgVectorMemoryBackend, SqliteMemoryBackend } from '../src/index.ts'
import { RECALL_LIMIT_MAX } from '../src/service.ts'

/** Mount the memory plugin on a fresh context (sqlite `:memory:` unless overridden). */
async function setup(config: memory.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(memory, config)
  return ctx
}

describe('dsh-memory sqlite backend', () => {
  it('registers ctx.memoryStore with the default sqlite backend when no config is given', async () => {
    const ctx = await setup()
    expect(ctx.memoryStore).toBeDefined()
    expect(ctx.memoryStore).toBeInstanceOf(SqliteMemoryBackend)
    await expect(ctx.memoryStore.recall('anything')).resolves.toEqual([])
  })

  it('retains a record verbatim and stores exactly one row', async () => {
    const ctx = await setup({ backend: 'sqlite', sqlite: { path: ':memory:' } })
    const record = await ctx.memoryStore.retain({ content: 'the user prefers concise answers' })
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(record.namespace).toBe('')
    expect(record.content).toBe('the user prefers concise answers')
    expect(record.createdAt).toBeGreaterThan(0)
    const backend = ctx.memoryStore as SqliteMemoryBackend
    const row = backend.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number }
    expect(row.n).toBe(1)
  })

  it('recall finds a retained record by overlapping query tokens and ranks it first', async () => {
    const ctx = await setup({ backend: 'sqlite', sqlite: { path: ':memory:' } })
    await ctx.memoryStore.retain({ content: 'the deployment runs on kubernetes with postgres' })
    await ctx.memoryStore.retain({ content: 'the user prefers python over javascript' })
    const results = await ctx.memoryStore.recall('kubernetes deployment')
    expect(results.length).toBeGreaterThan(0)
    const top = results[0]!
    expect(top.score).toBeGreaterThan(0)
    expect(top.content).toContain('kubernetes')
    expect(top.score).toBe(1)
  })

  it('recall respects the namespace filter and limit', async () => {
    const ctx = await setup({ backend: 'sqlite', sqlite: { path: ':memory:' } })
    await ctx.memoryStore.retain({ content: 'alpha fact one' })
    await ctx.memoryStore.retain({ content: 'alpha fact two' })
    await ctx.memoryStore.retain({ content: 'beta fact one', namespace: 'beta' })
    expect(await ctx.memoryStore.recall('fact', { limit: 1 })).toHaveLength(1)
    const beta = await ctx.memoryStore.recall('fact', { namespace: 'beta' })
    expect(beta).toHaveLength(1)
    expect(beta[0]!.namespace).toBe('beta')
  })

  it('isolates two namespaces', async () => {
    const ctx = await setup({ backend: 'sqlite', sqlite: { path: ':memory:' } })
    await ctx.memoryStore.retain({ content: 'secret plan', namespace: 'private' })
    const other = await ctx.memoryStore.recall('secret', { namespace: 'other' })
    expect(other).toHaveLength(0)
    const all = await ctx.memoryStore.recall('secret')
    expect(all).toHaveLength(1)
    expect(all[0]!.namespace).toBe('private')
  })

  it('get returns the exact record for a byte-identical key and undefined otherwise', async () => {
    const ctx = await setup({ backend: 'sqlite', sqlite: { path: ':memory:' } })
    await ctx.memoryStore.retain({ content: 'color=blue' })
    await ctx.memoryStore.retain({ content: 'threads=4', namespace: 'config' })
    const exact = await ctx.memoryStore.get('color=blue')
    expect(exact).toBeDefined()
    expect(exact!.content).toBe('color=blue')
    const scoped = await ctx.memoryStore.get('threads=4', { namespace: 'config' })
    expect(scoped).toBeDefined()
    expect(scoped!.namespace).toBe('config')
    const missing = await ctx.memoryStore.get('nope-key')
    expect(missing).toBeUndefined()
    const wrongNs = await ctx.memoryStore.get('threads=4', { namespace: 'other' })
    expect(wrongNs).toBeUndefined()
    // exact match does not fuzzy-match a near key (proves it is the exact path, not top-k)
    const near = await ctx.memoryStore.get('color=blu')
    expect(near).toBeUndefined()
  })

  it('get recovers ALL 5 stored facts byte-exact (the exact-recovery shape)', async () => {
    const ctx = await setup({ backend: 'sqlite', sqlite: { path: ':memory:' } })
    const facts = ['alpha=1', 'beta=2', 'gamma=3', 'delta=4', 'epsilon=5']
    for (const f of facts) await ctx.memoryStore.retain({ content: f, namespace: 'hd' })
    for (const f of facts) {
      const got = await ctx.memoryStore.get(f, { namespace: 'hd' })
      expect(got).toBeDefined()
      expect(got!.content).toBe(f)
    }
  })

  it('list returns EVERY record verbatim with no cap, and scopes to one namespace', async () => {
    const ctx = await setup({ backend: 'sqlite', sqlite: { path: ':memory:' } })
    await ctx.memoryStore.retain({ content: 'work one', namespace: 'work' })
    await ctx.memoryStore.retain({ content: 'work two', namespace: 'work' })
    await ctx.memoryStore.retain({ content: 'home one', namespace: 'home' })
    const all = await ctx.memoryStore.list()
    expect(all).toHaveLength(3)
    expect(all.map(r => r.content).sort()).toEqual(['home one', 'work one', 'work two'])
    const scoped = await ctx.memoryStore.list({ namespace: 'work' })
    expect(scoped).toHaveLength(2)
    expect(scoped.every(r => r.namespace === 'work')).toBe(true)
    expect(scoped.map(r => r.content).sort()).toEqual(['work one', 'work two'])
    const emptyNs = await ctx.memoryStore.list({ namespace: 'nope' })
    expect(emptyNs).toHaveLength(0)
  })

  it('list recovers ALL 40 facts byte-exact (the 37-exact-recovery shape reproduced)', async () => {
    const ctx = await setup({ backend: 'sqlite', sqlite: { path: ':memory:' } })
    const facts = Array.from({ length: 40 }, (_, i) => `hd-key-${String(i).padStart(2, '0')}=value-${i}`)
    for (const f of facts) await ctx.memoryStore.retain({ content: f, namespace: 'hrd02' })
    const listed = await ctx.memoryStore.list({ namespace: 'hrd02' })
    // No top-k cap: every byte-exact fact is present, and only them.
    expect(listed).toHaveLength(40)
    const contents = new Set(listed.map(r => r.content))
    for (const f of facts) expect(contents.has(f)).toBe(true)
    expect(listed.every(r => r.namespace === 'hrd02')).toBe(true)
    // Byte-exact: no prefix-matching subset, the exact strings survive.
    expect(contents.has('hd-key-00=value-0')).toBe(true)
    expect(contents.has('hd-key-39=value-39')).toBe(true)
  })

  it('recall clamps an oversized limit to the hard ceiling (RECALL_LIMIT_MAX)', async () => {
    const ctx = await setup({ backend: 'sqlite', sqlite: { path: ':memory:' } })
    const facts = Array.from({ length: 60 }, (_, i) => `ceiling fact number ${i}`)
    for (const f of facts) await ctx.memoryStore.retain({ content: f })
    const results = await ctx.memoryStore.recall('ceiling fact', { limit: 200 })
    // Both backends clamp to the exported ceiling; never return more than the bound.
    expect(results.length).toBeGreaterThan(0)
    expect(results.length).toBeLessThanOrEqual(RECALL_LIMIT_MAX)
    expect(results.length).toBe(60 <= RECALL_LIMIT_MAX ? 60 : RECALL_LIMIT_MAX)
    // An in-range limit still honors the caller.
    expect(await ctx.memoryStore.recall('ceiling fact', { limit: 5 })).toHaveLength(5)
  })

  it('reflect returns totals, per-namespace counts, and recent records newest-first', async () => {
    const ctx = await setup({ backend: 'sqlite', sqlite: { path: ':memory:' } })
    await ctx.memoryStore.retain({ content: 'first', namespace: 'work' })
    await ctx.memoryStore.retain({ content: 'second', namespace: 'work' })
    await ctx.memoryStore.retain({ content: 'third', namespace: 'home' })
    const summary = await ctx.memoryStore.reflect()
    expect(summary.total).toBe(3)
    expect(summary.byNamespace).toEqual({ work: 2, home: 1 })
    expect(summary.recent).toHaveLength(3)
    expect(summary.recent[0]!.content).toBe('third')
    expect(summary.recent[1]!.content).toBe('second')
    expect(summary.recent[2]!.content).toBe('first')
  })

  it('reflect scopes totals to one namespace when asked', async () => {
    const ctx = await setup({ backend: 'sqlite', sqlite: { path: ':memory:' } })
    await ctx.memoryStore.retain({ content: 'a', namespace: 'work' })
    await ctx.memoryStore.retain({ content: 'b', namespace: 'home' })
    const summary = await ctx.memoryStore.reflect({ namespace: 'work' })
    expect(summary.total).toBe(1)
    expect(summary.byNamespace).toEqual({ work: 1 })
  })

  it('closes the sqlite database when the owning fiber is disposed', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
    const backend = ctx.memoryStore as SqliteMemoryBackend
    await fiber.dispose()
    expect(() => backend.db.prepare('SELECT 1')).toThrow()
  })
})

describe('dsh-memory pgvector adapter', () => {
  it('ships a config-gated adapter that compiles and loads without `pg` installed', async () => {
    // Importing the module must not touch the `pg` driver (lazy dynamic import only);
    // the class and its schemastery config surface are enough to prove the shape.
    expect(PgVectorMemoryBackend).toBeTypeOf('function')
    expect(PgVectorMemoryBackend.Config).toBeDefined()
  })
})

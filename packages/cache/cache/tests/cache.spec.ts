import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, LlmRuntime, Message, StreamChunk } from '@atlasai/atsh-llm'
import LlmCache from '../src/index.ts'
import type { CacheHitRecord, CacheMissRecord } from '../src/index.ts'

/** Two-chunk fake stream standing in for the adapter's chunk emission. */
async function* fakeChunks(): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: 'hello' }
}

/** Drain a stream fully, returning the chunks in order. */
async function consume(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

/**
 * Drive one call through the same emission path as `LlmRuntime.stream()`: the waterfall
 * treats the leading object argument as the listener `this` (cast to `LlmRuntime` for
 * the types); the innermost callback is the adapter stream.
 */
function drive(
  ctx: Context,
  options: GenerateOptions,
  inner: () => AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  return ctx.waterfall(ctx as unknown as LlmRuntime, 'llm/stream', options, inner)
}

/** Deep-freeze a value the way the loop freezes assembled requests. */
function deepFreeze<T>(value: T): T {
  for (const entry of Object.values(value as Record<string, unknown>)) {
    if (entry !== null && typeof entry === 'object') deepFreeze(entry)
  }
  return Object.freeze(value)
}

/** One user message with a single text block (valid Message shape for the cache key). */
function msg(id: string, text: string): Message {
  return {
    id: id as unknown as Message['id'],
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

describe('dsh-cache', () => {
  it('passes the call through untouched when the cache is disabled', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmCache, { enabled: false })
    const options: GenerateOptions = {
      provider: 'a',
      model: 'b',
      messages: [msg('m1', 'hello')],
    }
    const chunks = await consume(drive(ctx, options, fakeChunks))
    expect(chunks).toHaveLength(2)
    expect(ctx.llmCache.getStats().entries).toBe(0)
  })

  it('serves an identical second call from the cache without an upstream hit', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmCache, {})
    let upstreamCalls = 0
    const inner = (): AsyncIterable<StreamChunk> => {
      upstreamCalls += 1
      return fakeChunks()
    }
    const options: GenerateOptions = {
      provider: 'a',
      model: 'b',
      messages: [msg('m1', 'hello')],
    }
    const first = await consume(drive(ctx, options, inner))
    expect(upstreamCalls).toBe(1)
    expect(ctx.llmCache.getStats().entries).toBe(1)

    const second = await consume(drive(ctx, options, inner))
    expect(upstreamCalls).toBe(1)
    expect(second).toEqual(first)
    const stats = ctx.llmCache.getStats()
    expect(stats.entries).toBe(1)
    expect(stats.hits).toBe(1)
  })

  it('misses when the messages differ, storing a second entry', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmCache, {})
    let upstreamCalls = 0
    const inner = (): AsyncIterable<StreamChunk> => {
      upstreamCalls += 1
      return fakeChunks()
    }
    await consume(
      drive(ctx, { provider: 'a', model: 'b', messages: [msg('m1', 'hello')] }, inner),
    )
    await consume(
      drive(ctx, { provider: 'a', model: 'b', messages: [msg('m2', 'world')] }, inner),
    )
    expect(upstreamCalls).toBe(2)
    const stats = ctx.llmCache.getStats()
    expect(stats.entries).toBe(2)
    expect(stats.misses).toBe(2)
    expect(stats.hits).toBe(0)
  })

  it('emits cache/miss on the first call and cache/hit (exact) on replay', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmCache, {})
    const misses: CacheMissRecord[] = []
    const hits: CacheHitRecord[] = []
    ctx.on('cache/miss', record => misses.push(record))
    ctx.on('cache/hit', record => hits.push(record))
    const options: GenerateOptions = {
      provider: 'a',
      model: 'b',
      messages: [msg('m1', 'hello')],
    }
    await consume(drive(ctx, options, fakeChunks))
    await consume(drive(ctx, options, fakeChunks))
    expect(misses).toHaveLength(1)
    expect(hits).toHaveLength(1)
    expect(misses[0]!.key).toEqual(expect.any(String))
    expect(hits[0]).toMatchObject({ key: misses[0]!.key, source: 'exact' })
    expect(hits[0]!.ts).toBeGreaterThanOrEqual(misses[0]!.ts)
  })

  it('does not store anything when the upstream stream throws', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmCache, {})
    const options: GenerateOptions = {
      provider: 'a',
      model: 'b',
      messages: [msg('m1', 'hello')],
    }
    await expect(
      consume(
        drive(ctx, options, () => {
          throw new Error('boom')
        }),
      ),
    ).rejects.toThrow('boom')
    expect(ctx.llmCache.getStats().entries).toBe(0)
  })

  it('reads a deep-frozen request without mutating it', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmCache, {})
    const options = deepFreeze<GenerateOptions>({
      provider: 'a',
      model: 'b',
      messages: [msg('m1', 'hello')],
    })
    const chunks = await consume(drive(ctx, options, fakeChunks))
    expect(chunks).toHaveLength(2)
    expect(ctx.llmCache.getStats().entries).toBe(1)
  })

  it('serves a near-match from the semantic tier without an upstream call', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmCache, { semantic: true, semanticThreshold: 0.9 })
    let upstreamCalls = 0
    const inner = (): AsyncIterable<StreamChunk> => {
      upstreamCalls += 1
      return fakeChunks()
    }
    const first: GenerateOptions = {
      provider: 'a',
      model: 'b',
      messages: [msg('m1', 'hello world cache test')],
    }
    const second: GenerateOptions = {
      provider: 'a',
      model: 'b',
      messages: [msg('m2', 'test cache world hello')],
    }
    const firstChunks = await consume(drive(ctx, first, inner))
    expect(upstreamCalls).toBe(1)

    const hits: CacheHitRecord[] = []
    ctx.on('cache/hit', record => hits.push(record))
    const secondChunks = await consume(drive(ctx, second, inner))
    expect(upstreamCalls).toBe(1)
    expect(secondChunks).toEqual(firstChunks)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ source: 'semantic' })
    expect(ctx.llmCache.getStats().hits).toBe(1)
  })

  it('closes the sqlite database when the owning fiber is disposed', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(LlmCache, {})
    const db = ctx.llmCache.db
    await fiber.dispose()
    expect(() => db.prepare('SELECT 1')).toThrow()
  })
})

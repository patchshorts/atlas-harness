import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, LlmRuntime, StreamChunk } from '@atlasai/atsh-llm'
import LlmRouter from '../src/index.ts'

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

describe('dsh-router', () => {
  it('passes the call through untouched when the router is disabled', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRouter, { enabled: false })
    const options: GenerateOptions = { provider: 'a', model: 'b', messages: [] }
    const chunks = await consume(drive(ctx, options, fakeChunks))
    expect(chunks).toHaveLength(2)
    expect(ctx.llmRouter.countCalls()).toBe(0)
  })

  it('logs a matched call with capability, route state, and chunk count', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRouter, {
      routes: { general: { provider: 'deepseek', model: 'deepseek-chat' } },
    })
    const options: GenerateOptions = {
      provider: 'deepseek',
      model: 'deepseek-chat',
      messages: [],
    }
    await consume(drive(ctx, options, fakeChunks))
    expect(ctx.llmRouter.countCalls()).toBe(1)
    const calls = ctx.llmRouter.listCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      capability: 'general',
      routeState: 'matched',
      status: 'ok',
      chunkCount: 2,
      requestedProvider: 'deepseek',
      requestedModel: 'deepseek-chat',
      resolvedProvider: 'deepseek',
      resolvedModel: 'deepseek-chat',
    })
  })

  it('rewrites provider/model on a non-frozen mismatch when applyRoutes is on', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRouter, {
      applyRoutes: true,
      routes: { general: { provider: 'deepseek', model: 'deepseek-chat' } },
    })
    const options: GenerateOptions = {
      provider: 'other',
      model: 'other-model',
      messages: [],
    }
    await consume(drive(ctx, options, fakeChunks))
    // The router mutated the hand-built (non-frozen) options in place.
    expect(options.provider).toBe('deepseek')
    expect(options.model).toBe('deepseek-chat')
    const calls = ctx.llmRouter.listCalls()
    expect(calls[0]).toMatchObject({
      routeState: 'rewritten',
      requestedProvider: 'other',
      requestedModel: 'other-model',
      resolvedProvider: 'deepseek',
      resolvedModel: 'deepseek-chat',
    })
  })

  it('never rewrites a deep-frozen request; it logs an advisory decision', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRouter, {
      applyRoutes: true,
      routes: { general: { provider: 'deepseek', model: 'deepseek-chat' } },
    })
    const options = deepFreeze<GenerateOptions>({
      provider: 'other',
      model: 'other-model',
      messages: [],
    })
    await consume(drive(ctx, options, fakeChunks))
    expect(options.provider).toBe('other')
    expect(options.model).toBe('other-model')
    const calls = ctx.llmRouter.listCalls()
    expect(calls[0]).toMatchObject({
      routeState: 'advisory',
      requestedProvider: 'other',
      resolvedProvider: 'other',
    })
  })

  it('logs an error row when the inner stream throws', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRouter, {})
    const options: GenerateOptions = { provider: 'a', model: 'b', messages: [] }
    await expect(
      consume(drive(ctx, options, () => {
        throw new Error('boom')
      })),
    ).rejects.toThrow('boom')
    const calls = ctx.llmRouter.listCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      status: 'error',
      errorCode: 'Error',
      chunkCount: 0,
      routeState: 'none',
    })
  })

  it('exposes the configured route per capability via routeFor', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRouter, {
      routes: { reasoning: { provider: 'p2', model: 'm2' } },
    })
    expect(ctx.llmRouter.routeFor('reasoning')).toEqual({ provider: 'p2', model: 'm2' })
    expect(ctx.llmRouter.routeFor('general')).toBeUndefined()
  })
})

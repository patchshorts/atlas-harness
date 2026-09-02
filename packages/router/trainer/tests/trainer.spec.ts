import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { LlmRuntime, StreamChunk } from '@atlasai/atsh-llm'
// Sibling-group relative imports (same as the memory pair): the router group is not in
// tsconfig.base.json's dsh-* path map, so package-name resolution would fall through to
// an unbuilt lib/.
import * as routerMod from '../../router/src/index.ts'
import RouterTrainer from '../src/index.ts'

/** Two-chunk fake stream standing in for the adapter's chunk emission. */
async function* fakeChunks(): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: 'hi' }
}

/** Drain a stream fully (the router logs the call when the stream settles). */
async function consume(stream: AsyncIterable<StreamChunk>): Promise<void> {
  for await (const _chunk of stream) {
    // drain
  }
}

describe('dsh-router-trainer', () => {
  it('collects every router/call-logged record into ctx.routerTrainer', async () => {
    const ctx = new Context()
    await ctx.plugin(routerMod.default, { enabled: true, routes: {} })
    await ctx.plugin(RouterTrainer, {})
    const options = { provider: 'a', model: 'b', messages: [] }
    await consume(
      ctx.waterfall(ctx as unknown as LlmRuntime, 'llm/stream', options, fakeChunks),
    )
    expect(ctx.routerTrainer.count()).toBe(1)
    const records = ctx.routerTrainer.records()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      capability: 'general',
      routeState: 'none',
      status: 'ok',
      chunkCount: 2,
      requestedProvider: 'a',
      resolvedProvider: 'a',
    })
  })

  it('appends one JSONL line per call when outputPath is configured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'router-trainer-'))
    const outputPath = join(dir, 'calls.jsonl')
    const ctx = new Context()
    await ctx.plugin(routerMod.default, { enabled: true, routes: {} })
    await ctx.plugin(RouterTrainer, { outputPath })
    const options = { provider: 'a', model: 'b', messages: [] }
    await consume(
      ctx.waterfall(ctx as unknown as LlmRuntime, 'llm/stream', options, fakeChunks),
    )
    const lines = readFileSync(outputPath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!) as {
      id: string
      status: string
      chunkCount: number
      capability: string
    }
    expect(parsed).toMatchObject({ status: 'ok', chunkCount: 2, capability: 'general' })
    expect(parsed.id).toBeTruthy()
    expect(ctx.routerTrainer.count()).toBe(1)
  })

  it('consumes a correction record as a reward on the matching call and same JSONL log', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'router-trainer-'))
    const outputPath = join(dir, 'calls.jsonl')
    const ctx = new Context()
    await ctx.plugin(routerMod.default, { enabled: true, routes: {} })
    await ctx.plugin(RouterTrainer, { outputPath })
    const options = { provider: 'a', model: 'b', messages: [] }
    await consume(
      ctx.waterfall(ctx as unknown as LlmRuntime, 'llm/stream', options, fakeChunks),
    )
    const callId = ctx.routerTrainer.records()[0]!.id
    ctx.routerTrainer.recordCorrection({
      id: 'corr-1',
      callId,
      ts: Date.now(),
      classification: 'C1',
      note: 'retried failed tool',
    })

    // The trainer consumed the correction as a reward, and only on the matching call.
    expect(ctx.routerTrainer.corrections()).toHaveLength(1)
    expect(ctx.routerTrainer.rewards()).toHaveLength(1)
    const [rewarded] = ctx.routerTrainer.rewards()
    expect(rewarded?.id).toBe(callId)
    expect(rewarded?.reward).toMatchObject({ callId, classification: 'C1' })

    // The correction landed in the SAME JSONL log as the samples (2 lines: 1 call + 1 correction).
    const lines = readFileSync(outputPath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!)).toMatchObject({ id: 'corr-1', classification: 'C1' })

    // A correction referencing an unknown call is still recorded, never dropped.
    ctx.routerTrainer.recordCorrection({
      id: 'corr-2',
      callId: 'no-such-call',
      ts: Date.now(),
    })
    expect(ctx.routerTrainer.corrections()).toHaveLength(2)
    expect(ctx.routerTrainer.rewards()).toHaveLength(1)
  })

  it('keeps corrections when no outputPath is set and reset() drops the whole queue', async () => {
    const ctx = new Context()
    await ctx.plugin(routerMod.default, { enabled: true, routes: {} })
    await ctx.plugin(RouterTrainer, {})
    const options = { provider: 'a', model: 'b', messages: [] }
    await consume(
      ctx.waterfall(ctx as unknown as LlmRuntime, 'llm/stream', options, fakeChunks),
    )
    const callId = ctx.routerTrainer.records()[0]!.id
    ctx.routerTrainer.recordCorrection({ id: 'corr-1', callId, ts: Date.now() })
    expect(ctx.routerTrainer.corrections()).toHaveLength(1)
    expect(ctx.routerTrainer.rewards()).toHaveLength(1)

    ctx.routerTrainer.reset()
    expect(ctx.routerTrainer.count()).toBe(0)
    expect(ctx.routerTrainer.corrections()).toHaveLength(0)
    expect(ctx.routerTrainer.rewards()).toHaveLength(0)
  })

  it('rejects an unknown config key before defaults can hide it', async () => {
    const ctx = new Context()
    await ctx.plugin(routerMod.default, { enabled: true, routes: {} })
    // Cast past the typed config so a misspelled key reaches runtime validation.
    const bogusConfig = { outputPath: undefined, bogus: true } as unknown as import('../src/index.ts').TrainerConfig
    await expect(ctx.plugin(RouterTrainer, bogusConfig)).rejects.toThrow(/unknown key/)
  })
})

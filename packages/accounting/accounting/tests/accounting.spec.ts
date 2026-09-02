/**
 * Unit coverage for @atlasai/atsh-accounting: ledger debits from
 * intercepted `llm/stream` usage, credit grants, and budget-cap vetoes at the
 * `tools/execute` boundary. The llm/stream path drives the same waterfall
 * emission as `LlmRuntime.stream()`; the tool path mounts a real ToolRuntime
 * and executes a registered probe tool.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@atlasai/atsh-llm'
import type { GenerateOptions, LlmRuntime, StreamChunk } from '@atlasai/atsh-llm'
import SystemPrompt from '@atlasai/atsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@atlasai/atsh-tools'
import AccountingService from '../src/index.ts'

/** A fake stream with a 40-input / 60-output usage chunk (100 tokens total). */
async function* chunksWithUsage(): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: 'hello' }
  yield {
    type: 'usage',
    usage: { inputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 60 },
  }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** A fake stream with NO usage chunk (a call that reported no tokens). */
async function* chunksWithoutUsage(): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: 'hello' }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** A fake stream with a 40-token usage chunk (under-cap call). */
async function* chunksWithSmallUsage(): AsyncGenerator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield {
    type: 'usage',
    usage: { inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 30 },
  }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Drain a stream fully, returning the chunks in order. */
async function consume(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

/**
 * Drive one call through the same emission path as `LlmRuntime.stream()`: the
 * waterfall treats the leading object argument as the listener `this` (cast to
 * `LlmRuntime` for the types); the innermost callback is the adapter stream.
 */
function drive(
  ctx: Context,
  options: GenerateOptions,
  inner: () => AsyncIterable<StreamChunk>,
): AsyncIterable<StreamChunk> {
  return ctx.waterfall(ctx as unknown as LlmRuntime, 'llm/stream', options, inner)
}

/** Mount the registry + a probe tool whose execution is counted. */
async function setupTools(ctx: Context, executed: { count: number }) {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(defineContentToolFixture({
    name: 'probe',
    description: 'probe tool',
    parameters: {},
    execute: async () => {
      executed.count += 1
      return [{ type: 'text' as const, text: 'ok' }]
    },
  }))
}

/** Read the ledger's kinds in order (newest first). */
function kinds(rows: { kind: string }[]): string[] {
  return rows.map(row => row.kind)
}

describe('dsh-accounting', () => {
  it('delegates untouched when disabled (no ledger, no events, stream intact)', async () => {
    const ctx = new Context()
    await ctx.plugin(AccountingService, { enabled: false })
    const options: GenerateOptions = { provider: 'p', model: 'm', messages: [] }
    const chunks = await consume(drive(ctx, options, chunksWithUsage))
    expect(chunks).toHaveLength(4)
    expect(ctx.accounting.listLedger()).toHaveLength(0)
    expect(ctx.accounting.getStats()).toEqual({ grants: 0, debits: 0, accounts: 0 })
  })

  it('grant adds balance, writes a grant row, and emits accounting/grant', async () => {
    const ctx = new Context()
    await ctx.plugin(AccountingService, {})
    const grants: { account: string; amount: number }[] = []
    ctx.on('accounting/grant', record => grants.push(record))
    const balance = ctx.accounting.grant(100, 'test grant')
    expect(balance).toBe(100)
    expect(ctx.accounting.getBalance()).toBe(100)
    expect(ctx.accounting.getStats()).toEqual({ grants: 1, debits: 0, accounts: 1 })
    const rows = ctx.accounting.listLedger()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'grant', amount: 100, balanceAfter: 100, reason: 'test grant' })
    expect(grants).toHaveLength(1)
    expect(grants[0]?.amount).toBe(100)
  })

  it('llm call with usage writes a debit row, reduces balance, and emits accounting/debit', async () => {
    const ctx = new Context()
    await ctx.plugin(AccountingService, { credits: 100 })
    const debits: { account: string; amount: number }[] = []
    ctx.on('accounting/debit', record => debits.push(record))
    const options: GenerateOptions = { provider: 'p', model: 'm', messages: [] }
    const chunks = await consume(drive(ctx, options, chunksWithUsage))
    expect(chunks).toHaveLength(4)
    expect(ctx.accounting.getBalance()).toBe(0)
    expect(ctx.accounting.getStats()).toEqual({ grants: 1, debits: 1, accounts: 1 })
    const rows = ctx.accounting.listLedger()
    expect(kinds(rows)).toEqual(['debit', 'grant'])
    expect(rows[0]?.kind).toBe('debit')
    expect(rows[0]?.amount).toBe(-100)
    expect(rows[0]?.balanceAfter).toBe(0)
    expect(rows[0]?.reason).toBe('llm-call')
    expect(rows[0]?.meta).toEqual({ provider: 'p', model: 'm' })
    expect(debits).toHaveLength(1)
    expect(debits[0]?.amount).toBe(100)
  })

  it('llm call with no usage chunk writes no debit', async () => {
    const ctx = new Context()
    await ctx.plugin(AccountingService, { credits: 100 })
    const debits: unknown[] = []
    ctx.on('accounting/debit', record => debits.push(record))
    const options: GenerateOptions = { provider: 'p', model: 'm', messages: [] }
    await consume(drive(ctx, options, chunksWithoutUsage))
    expect(ctx.accounting.getBalance()).toBe(100)
    expect(ctx.accounting.getStats()).toEqual({ grants: 1, debits: 0, accounts: 1 })
    expect(debits).toHaveLength(0)
  })

  it('initial credits are granted once on mount', async () => {
    const ctx = new Context()
    await ctx.plugin(AccountingService, { credits: 50 })
    expect(ctx.accounting.getBalance()).toBe(50)
    const rows = ctx.accounting.listLedger()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('grant')
    expect(rows[0]?.amount).toBe(50)
    expect(rows[0]?.reason).toBe('initial credits')
  })

  it('budget cap vetoes the tool call at the tools/execute boundary', async () => {
    const ctx = new Context()
    await ctx.plugin(AccountingService, { budgets: { default: 100 } })
    const executed = { count: 0 }
    await setupTools(ctx, executed)
    const options: GenerateOptions = { provider: 'p', model: 'm', messages: [] }
    await consume(drive(ctx, options, chunksWithUsage))
    expect(ctx.accounting.spendFor()).toBe(100)
    const result = await ctx.tools.execute({
      callId: CallId('c1'),
      name: 'probe',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('BUDGET_EXCEEDED')
    expect(executed.count).toBe(0)
  })

  it('tool call passes when spend is under the cap', async () => {
    const ctx = new Context()
    await ctx.plugin(AccountingService, { budgets: { default: 100 } })
    const executed = { count: 0 }
    await setupTools(ctx, executed)
    const options: GenerateOptions = { provider: 'p', model: 'm', messages: [] }
    await consume(drive(ctx, options, chunksWithSmallUsage))
    expect(ctx.accounting.spendFor()).toBe(40)
    const result = await ctx.tools.execute({
      callId: CallId('c1'),
      name: 'probe',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(executed.count).toBe(1)
  })

  it('tool call passes when no budget is configured (passive accounting)', async () => {
    const ctx = new Context()
    await ctx.plugin(AccountingService, {})
    const executed = { count: 0 }
    await setupTools(ctx, executed)
    const options: GenerateOptions = { provider: 'p', model: 'm', messages: [] }
    await consume(drive(ctx, options, chunksWithUsage))
    expect(ctx.accounting.spendFor()).toBe(100)
    const result = await ctx.tools.execute({
      callId: CallId('c1'),
      name: 'probe',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(executed.count).toBe(1)
  })

  it('stats and ledger shapes after a grant plus a small debit', async () => {
    const ctx = new Context()
    await ctx.plugin(AccountingService, { credits: 100 })
    const options: GenerateOptions = { provider: 'p', model: 'm', messages: [] }
    await consume(drive(ctx, options, chunksWithSmallUsage))
    expect(ctx.accounting.getStats()).toEqual({ grants: 1, debits: 1, accounts: 1 })
    const rows = ctx.accounting.listLedger(10)
    expect(rows).toHaveLength(2)
    expect(kinds(rows)).toEqual(['debit', 'grant'])
    expect(rows[0]?.amount).toBe(-40)
    expect(rows[0]?.balanceAfter).toBe(60)
    expect(ctx.accounting.getBalance()).toBe(60)
  })

  it('public charge writes a debit row, reduces balance, and emits accounting/debit', async () => {
    const ctx = new Context()
    await ctx.plugin(AccountingService, { credits: 100 })
    const debits: unknown[] = []
    ctx.on('accounting/debit', record => debits.push(record))
    ctx.accounting.charge('default', 40, 'judge-replan', { planId: 'p1' })
    expect(ctx.accounting.getBalance()).toBe(60)
    const rows = ctx.accounting.listLedger(1)
    expect(rows[0]).toMatchObject({ kind: 'debit', reason: 'judge-replan', amount: -40 })
    expect(rows[0]?.meta).toEqual({ planId: 'p1' })
    expect(debits).toHaveLength(1)
    expect(debits[0]).toMatchObject({ account: 'default', amount: 40, reason: 'judge-replan' })
  })
})

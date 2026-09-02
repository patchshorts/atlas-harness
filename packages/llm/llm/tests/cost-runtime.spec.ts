import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  BUDGET_EXCEEDED_CODE,
  LlmAdapter,
  LlmBudgetError,
  LlmCostEvent,
  type GenerateOptions,
  type StreamChunk,
} from '@atlasai/atsh-llm'

/**
 * Scripted adapter: emits a fixed chunk script per call. Counts invocations
 * so tests can prove a refused call never reaches the provider.
 */
class CountingAdapter extends LlmAdapter {
  calls = 0

  constructor(private readonly script: StreamChunk[]) {
    super()
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    yield * this.script
  }
}

/** One usage chunk worth 25 cents under RATES (10 + 20*0.5 + 5). */
const USAGE: StreamChunk = {
  type: 'usage',
  usage: { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 1_000_000 },
}

const USAGE_SCRIPT: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'hi' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } },
  USAGE,
  { type: 'finish', reason: { kind: 'stop' } },
]

/** Same stream shape without a usage chunk (zero-usage streams record nothing). */
const NO_USAGE_SCRIPT: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'hi' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } },
  { type: 'finish', reason: { kind: 'stop' } },
]

/** 10c/M input, 20c/M output, 5c/M cache-read, in USD cents. */
const RATES = {
  'test-model': { inputPerM: 10, outputPerM: 20, cacheReadPerM: 5 },
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

function listen(ctx: Context): LlmCostEvent[] {
  const events: LlmCostEvent[] = []
  ctx.on('llm/cost', event => events.push(event))
  return events
}

const CALL = { provider: 'test-provider', model: 'test-model', messages: [] }

describe('LlmRuntime cost wiring', () => {
  it('passes chunks through unchanged and emits nothing when cost config is absent', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const adapter = new CountingAdapter(NO_USAGE_SCRIPT)
    ctx.llm.registerAdapter(['test-provider'], adapter)
    const events = listen(ctx)

    const chunks = await collect(ctx.llm.stream(CALL))

    expect(chunks).toEqual(NO_USAGE_SCRIPT)
    expect(adapter.calls).toBe(1)
    expect(events).toEqual([])
  })

  it('records usage into the ledger and emits llm/cost with the session total', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime, { rates: RATES })
    const adapter = new CountingAdapter(USAGE_SCRIPT)
    ctx.llm.registerAdapter(['test-provider'], adapter)
    const events = listen(ctx)

    const chunks = await collect(ctx.llm.stream(CALL))

    expect(chunks).toEqual(USAGE_SCRIPT)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      sessionKey: 'default',
      model: 'test-model',
      spentCents: 25,
    })
  })

  it('keeps per-session totals independent and labels events with the session key', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime, { rates: RATES })
    const adapter = new CountingAdapter(USAGE_SCRIPT)
    ctx.llm.registerAdapter(['test-provider'], adapter)
    const events = listen(ctx)

    await collect(ctx.llm.stream({ ...CALL, sessionKey: 'alpha' }))
    await collect(ctx.llm.stream({ ...CALL, sessionKey: 'beta' }))
    await collect(ctx.llm.stream({ ...CALL, sessionKey: 'alpha' }))

    expect(events.map(event => [event.sessionKey, event.spentCents])).toEqual([
      ['alpha', 25],
      ['beta', 25],
      ['alpha', 50],
    ])
  })

  it('refuses an over-budget call with LlmBudgetError before any provider call', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime, { rates: RATES, budgetCents: 30 })
    const adapter = new CountingAdapter(USAGE_SCRIPT)
    ctx.llm.registerAdapter(['test-provider'], adapter)

    // spent 0 -> 25 -> 50: the third call starts at 50 >= 30 and must refuse.
    await collect(ctx.llm.stream(CALL))
    await collect(ctx.llm.stream(CALL))

    expect(() => ctx.llm.stream(CALL)).toThrow(
      expect.objectContaining({ name: 'LlmBudgetError', code: BUDGET_EXCEEDED_CODE }),
    )
    expect(adapter.calls).toBe(2)
  })

  it('refuses deterministically when the session has spent exactly the budget', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime, { rates: RATES, budgetCents: 25 })
    const adapter = new CountingAdapter(USAGE_SCRIPT)
    ctx.llm.registerAdapter(['test-provider'], adapter)

    await collect(ctx.llm.stream(CALL))

    expect(() => ctx.llm.stream(CALL)).toThrow(LlmBudgetError)
    expect(adapter.calls).toBe(1)
  })

  it('lets an unrated-model session pass and records zero-cent events', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime, { budgetCents: 10 })
    const adapter = new CountingAdapter(USAGE_SCRIPT)
    ctx.llm.registerAdapter(['test-provider'], adapter)
    const events = listen(ctx)

    await collect(ctx.llm.stream(CALL))
    await collect(ctx.llm.stream(CALL))

    expect(adapter.calls).toBe(2)
    expect(events).toHaveLength(2)
    expect(events.at(-1)?.spentCents).toBe(0)
  })

  it('refuses over-budget calls on the prepared-call path too', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime, { rates: RATES, budgetCents: 30 })
    const adapter = new CountingAdapter(USAGE_SCRIPT)
    ctx.llm.registerAdapter(['test-provider'], adapter)
    const prepared = await ctx.llm.prepareCall({ provider: 'test-provider', model: 'test-model' })

    await collect(ctx.llm.stream(CALL))
    await collect(ctx.llm.stream(CALL))

    expect(() => prepared.stream(CALL)).toThrow(LlmBudgetError)
    expect(adapter.calls).toBe(2)
  })
})

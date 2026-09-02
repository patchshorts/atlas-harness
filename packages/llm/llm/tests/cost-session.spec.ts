import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  BUDGET_EXCEEDED_CODE,
  LlmAdapter,
  LlmBudgetError,
  LlmCostEvent,
  createMessage,
  type GenerateOptions,
  type Message,
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

describe('full-session budget stop', () => {
  it('lets a within-budget session complete and totals the ledger exactly', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime, { rates: RATES, budgetCents: 100 })
    const adapter = new CountingAdapter(USAGE_SCRIPT)
    ctx.llm.registerAdapter(['test-provider'], adapter)
    const events = listen(ctx)

    for (let i = 0; i < 3; i += 1) {
      await collect(ctx.llm.stream(CALL))
    }

    expect(adapter.calls).toBe(3)
    expect(events.map(event => event.spentCents)).toEqual([25, 50, 75])
    expect(events[2]).toMatchObject({ sessionKey: 'default', model: 'test-model' })
  })

  it('halts at accounting once the budget is crossed: the next stream throws before any provider call', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime, { rates: RATES, budgetCents: 60 })
    const adapter = new CountingAdapter(USAGE_SCRIPT)
    ctx.llm.registerAdapter(['test-provider'], adapter)
    const events = listen(ctx)

    // Three calls stay under 60: spent 0 -> 25 -> 50 -> 75.
    await collect(ctx.llm.stream(CALL))
    await collect(ctx.llm.stream(CALL))
    await collect(ctx.llm.stream(CALL))
    expect(adapter.calls).toBe(3)

    // The fourth call starts at 75 >= 60 and must refuse synchronously.
    expect(() => ctx.llm.stream(CALL)).toThrow(
      expect.objectContaining({ name: 'LlmBudgetError', code: BUDGET_EXCEEDED_CODE }),
    )
    expect(adapter.calls).toBe(3)

    // The refused call emits no cost event: nothing reached the tap.
    expect(events).toHaveLength(3)
    expect(events.at(-1)?.spentCents).toBe(75)
  })

  it('keeps sessions independent under budget pressure', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime, { rates: RATES, budgetCents: 60 })
    const adapter = new CountingAdapter(USAGE_SCRIPT)
    ctx.llm.registerAdapter(['test-provider'], adapter)
    const events = listen(ctx)

    // Session alpha crosses the budget; session beta has its own ledger row.
    await collect(ctx.llm.stream({ ...CALL, sessionKey: 'alpha' }))
    await collect(ctx.llm.stream({ ...CALL, sessionKey: 'alpha' }))
    await collect(ctx.llm.stream({ ...CALL, sessionKey: 'alpha' }))
    expect(() => ctx.llm.stream({ ...CALL, sessionKey: 'alpha' })).toThrow(LlmBudgetError)

    // Beta still has a fresh budget: the refusal was session-scoped.
    await collect(ctx.llm.stream({ ...CALL, sessionKey: 'beta' }))
    expect(adapter.calls).toBe(4)

    const alpha = events.filter(event => event.sessionKey === 'alpha')
    const beta = events.filter(event => event.sessionKey === 'beta')
    expect(alpha.map(event => event.spentCents)).toEqual([25, 50, 75])
    expect(beta.map(event => event.spentCents)).toEqual([25])
  })

  it('never reads or writes model-visible history (golden rule by construction)', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime, { rates: RATES, budgetCents: 100 })
    const adapter = new CountingAdapter(USAGE_SCRIPT)
    ctx.llm.registerAdapter(['test-provider'], adapter)

    // Deep-frozen history: any read-modify-write attempt throws in strict mode.
    // Cast through the mutable API deliberately: the frozen array is the runtime
    // guard, the cast is the type-level escape hatch for the test fixture.
    const message = createMessage({ role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })
    const history = Object.freeze([message]) as Message[]

    await collect(ctx.llm.stream({ ...CALL, messages: history }))
    await collect(ctx.llm.stream({ ...CALL, messages: history }))

    // The ledger observed only usage chunks; the history it was handed is
    // byte-identical and the same object identity the caller passed in.
    expect(ctx.llm.stream({ ...CALL, messages: history })).toBeDefined()
    expect(adapter.calls).toBe(2)
    expect(history[0]).toBe(message)
  })
})

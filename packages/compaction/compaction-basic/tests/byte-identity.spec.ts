/**
 * byte-identity — the prefix-cache compatibility proof of the D3 contract
 *: compaction DERIVES a new projection and never rewrites history,
 * so every log prefix that contains no compacted spans folds to byte-identical
 * output before and after compaction.
 *
 * Golden rule (docs/paper/paper.md:62): never mutate model-visible history;
 * message history is derived from the log by a pure function fold; deep-frozen
 * projections throw on mutation. Economics: provider KV prefix caching — a
 * request prefix that folds identically reuses the cached prompt (120x cost
 * gap: $0.0033/M cached vs $0.435/M uncached).
 *
 * Contract under test: for every prefix length k with k <= seq of the first
 * compaction event (the prefix contains NO compaction events),
 *
 *   JSON.stringify(foldSurface(log[:k]))  is byte-identical  before and after
 *   compaction.
 *
 * The log prefix is byte-identical (compaction only appends four events), so
 * this is a proof about the FOLD: it is a pure, deterministic function of the
 * prefix, and the provider's cached prefix remains valid across the compaction
 * boundary. Boundary samples pin the semantics: k = 0 (empty surface),
 * k = span start (prefix ends exactly at the first shadowed node), k inside
 * the shadowed span (partial-span prefixes fold identically and are pure
 * prefix functions of the full fold), and k = N (just before the compaction
 * marker — the full pre-compaction surface).
 *
 * Companion spec: derive-never-rewrite.spec.ts proves the no-mutation path
 * (byte-identical events, append-only growth, NEW replacement event, debt-
 * metric trigger). This spec proves the byte-identity consequence the
 * economics depend on.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  createMessage,
  createUserMessage,
  LlmAdapter,
} from '@atlasai/atsh-llm'
import type {
  LlmResolvedModelInfo,
  StreamChunk,
} from '@atlasai/atsh-llm'
import { Session, SessionId } from '@atlasai/atsh-session'
import { foldSurface } from '@atlasai/atsh-session/surface'
import TokenMeter from '@atlasai/atsh-token-meter'
import BasicCompactionEngine from '@atlasai/atsh-compaction-basic'
import type { BasicCompactionConfig } from '@atlasai/atsh-compaction-basic'
import type {
  SummarizationInput,
  SummaryResult,
} from '@atlasai/atsh-compaction-basic/src/summarizer.ts'
import type { Agent } from '@atlasai/atsh-agent'
import type { CompactionResult } from '@atlasai/atsh-compaction'

const MODEL = 'test-model'
const SIGNAL = new AbortController().signal

/** Minimal LLM adapter carrying a configurable context window. */
class ContextAdapter extends LlmAdapter {
  constructor(private readonly contextWindow: number) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: this.contextWindow },
    })
  }

  override async * stream(): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Context with LLM runtime + token meter; threshold = 0.5 * contextWindow. */
function createContext(contextWindow = 1_000): Context {
  const ctx = new Context()
  void new LlmRuntime(ctx)
  void new TokenMeter(ctx)
  ctx.llm.registerAdapter([MODEL, 'actual', 'unlisted-provider'], new ContextAdapter(contextWindow))
  return ctx
}

/** Closed turns + one open turn, so durable compaction events have an owner. */
function conversation(turns = 4, text = 'fixture '.repeat(40).trim()): Session {
  const session = Session.create(SessionId(`conversation-${turns}`))
  for (let turn = 1; turn <= turns; turn += 1) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `${text} user ${turn}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    if (turn === 1) {
      session.append('request/header', {
        header: { config: { provider: MODEL, model: MODEL } },
        reason: 'initial',
      })
    }
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: `${text} assistant ${turn}` }],
        source: { kind: 'model', provider: MODEL, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  session.append('turn/start', { turn: turns + 1 })
  return session
}

/** Engine with a deterministic summarizer (no real LLM call). */
class TestCompactionEngine extends BasicCompactionEngine {
  calls: Array<{ input: SummarizationInput; signal: AbortSignal | undefined }> = []

  override async summarize(
    input: SummarizationInput,
    _agent: Agent,
    signal?: AbortSignal,
  ): Promise<SummaryResult> {
    this.calls.push({ input, signal })
    return {
      summary: [{ type: 'text', text: 'small checkpoint' }],
      provider: 'summary-provider',
      model: 'summary-model',
      maxTokens: 123,
    }
  }
}

function service(
  config: BasicCompactionConfig = { auto: false },
  ctx = createContext(),
): TestCompactionEngine {
  return new TestCompactionEngine(ctx, config)
}

function agent(session: Session, model = MODEL): Agent {
  return { session, options: { provider: model, model } } as Agent
}

async function compactIfNeeded(
  compact: BasicCompactionEngine,
  session: Session,
  trigger: 'pressure' | 'context-overflow' = 'pressure',
): Promise<CompactionResult | null> {
  return compact.compactIfNeeded(agent(session), trigger, SIGNAL)
}

/** Pressure config proven above-threshold for 4 turns (724t >= 500t). */
const PRESSURE_CONFIG: BasicCompactionConfig = {
  auto: false,
  thresholdRatio: 0.5,
  retainTokens: 180,
}

/** Compact a fresh 4-turn session; return the pre/post logs and the result. */
async function compactedPair(): Promise<{
  before: Session['events']
  after: Session['events']
  beforeCount: number
  result: CompactionResult
}> {
  const compact = service(PRESSURE_CONFIG)
  const session = conversation(4)
  const before = session.events.slice()
  const beforeCount = before.length
  const result = await compactIfNeeded(compact, session)
  expect(result).not.toBeNull()
  return { before, after: session.events, beforeCount, result: result! }
}

describe('byte-identity: prefixes without compacted spans fold byte-identically', () => {
  it('fold(log[:k]) is byte-identical pre/post compaction for every k in 0..N', async () => {
    const { before, after, beforeCount, result } = await compactedPair()
    // The first compaction event (compaction/start) sits at seq N: every
    // prefix k <= N contains no compaction events at all, so the sweep bound
    // is exactly the no-compacted-span boundary.
    expect(result.startSeq).toBe(beforeCount)

    for (let k = 0; k <= beforeCount; k += 1) {
      // The log prefix itself is byte-identical (compaction only appends).
      expect(JSON.stringify(after.slice(0, k))).toBe(JSON.stringify(before.slice(0, k)))
      // The fold of that prefix is byte-identical — the provider KV-cache
      // compatibility proof: any cached prefix stays valid across the
      // compaction boundary.
      expect(JSON.stringify(foldSurface(after.slice(0, k))))
        .toBe(JSON.stringify(foldSurface(before.slice(0, k))))
    }
  })

  it('k = 0 folds to the empty surface', async () => {
    const { before, after } = await compactedPair()
    const empty = JSON.stringify({ nodes: [], replacements: [] })
    expect(JSON.stringify(foldSurface(before.slice(0, 0)))).toBe(empty)
    expect(JSON.stringify(foldSurface(after.slice(0, 0)))).toBe(empty)
  })

  it('k = span start ends exactly at the first shadowed node', async () => {
    const { before, after, result } = await compactedPair()
    const k = result.shadowedRange.start
    const pre = foldSurface(before.slice(0, k))
    const post = foldSurface(after.slice(0, k))
    expect(JSON.stringify(post)).toBe(JSON.stringify(pre))
    // The prefix ends at the span boundary: no surface node at or after the
    // span start, and no replacement operation anywhere in the prefix.
    expect(pre.nodes.every(seq => seq < k)).toBe(true)
    expect(pre.replacements).toEqual([])
  })

  it('partial-span prefixes fold identically and are pure prefix functions', async () => {
    const { before, after, beforeCount, result } = await compactedPair()
    // k inside the shadowed span: includes shadowed nodes but stops before the
    // compaction marker. The deepest such prefix is N-1.
    const interior = [
      result.shadowedRange.start + 1, // first shadowed node inside the prefix
      result.shadowedRange.end + 1,   // every shadowed node inside the prefix
      beforeCount - 1,                // deepest prefix before the marker
    ]
    const full = foldSurface(before)
    for (const k of interior) {
      expect(k).toBeGreaterThan(0)
      expect(k).toBeLessThan(beforeCount)
      const pre = foldSurface(before.slice(0, k))
      const post = foldSurface(after.slice(0, k))
      expect(JSON.stringify(post)).toBe(JSON.stringify(pre))
      // The fold is a pure prefix function: a partial-prefix surface is the
      // full surface restricted to seqs below k.
      expect(pre.nodes).toEqual(full.nodes.filter(seq => seq < k))
      expect(pre.replacements).toEqual([])
    }
  })

  it('k = N (just before the compaction marker) folds to the full pre-compaction surface', async () => {
    const { before, after, beforeCount, result } = await compactedPair()
    const k = result.startSeq
    expect(k).toBe(beforeCount)
    const preFull = foldSurface(before)
    const postPrefix = foldSurface(after.slice(0, k))
    expect(JSON.stringify(postPrefix)).toBe(JSON.stringify(preFull))
    expect(postPrefix.nodes).toEqual(preFull.nodes)
    expect(postPrefix.replacements).toEqual([])
  })
})

describe('byte-identity: the post-compaction fold replaces exactly the shadowed span', () => {
  it('the checkpoint shadows exactly result.shadowedSeqs; the retained tail survives', async () => {
    const { after, result } = await compactedPair()
    const replacement = after[result.startSeq + 2]
    expect(replacement).toBeDefined()
    expect(replacement!.type).toBe('user/message')

    // Pre-compaction surface derived from the pure fold of the pre-compaction
    // log (never from session.surface.nodes — that is the LIVE fold-state
    // array, which compaction mutates in place).
    const preSurface = foldSurface(after.slice(0, result.startSeq)).nodes
    const retained = preSurface.filter(seq => !result.shadowedSeqs.includes(seq))

    const fold = foldSurface(after)
    expect(fold.nodes).toEqual([replacement!.seq, ...retained])
    expect(fold.replacements).toEqual([{
      seq: replacement!.seq,
      start: result.shadowedRange.start,
      end: result.shadowedRange.end,
      shadowedSeqs: [...result.shadowedSeqs],
    }])
  })
})

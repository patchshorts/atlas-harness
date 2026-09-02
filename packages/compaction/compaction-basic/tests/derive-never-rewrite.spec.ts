/**
 * derive-never-rewrite — the D3 contract of the Atlas context-debt compaction
 * workstream: compaction DERIVES a new model-visible projection from
 * the append-only session log; it never rewrites the log, never mutates any
 * prior projection, and never reorders or replaces existing events.
 *
 * Golden rule (docs/paper/paper.md:62): never mutate model-visible history;
 * message history is derived from the log by a pure function fold; deep-frozen
 * projections throw on mutation.
 *
 * Write-path inventory (src/, every session-log writer in the dependency
 * closure of compaction-basic):
 *
 *   packages/compaction/compaction-basic/src/region.ts
 *     THE ONLY WRITER. `compactSurfaceRegion` appends exactly four events via
 *     `session.append(...)` in this order:
 *       compaction/start → compaction/summary → user/message (surfaceOp
 *       { op: 'replace', start, end } + sourceEventSeqs) → compaction/end
 *     Append-only: it never edits, deletes, or reorders an existing event.
 *   packages/compaction/compaction-basic/src/index.ts
 *     No direct log writes. The engine reads (requestHeader, surface,
 *     tokenMeter.measure) and delegates mutation to compactSurfaceRegion.
 *   packages/compaction/compaction-basic/src/summarizer.ts
 *     No session access at all; pure framing (frameSummary) + one llm.stream()
 *     call whose messages are a derived prefix, never a log write.
 *   packages/compaction/compaction-basic/src/config.ts / types.ts / invariant.ts
 *     Pure configuration, types, and read-only checks. No writes.
 *   packages/session/session-context-debt/src/service.ts + fold.ts
 *     Stateless pure folds; the service header commits: "the JSONL log stays
 *     byte-identical after any scan/plan/report call." No writes.
 *   packages/core/session/src/surface.ts
 *     Pure foldSurface: fresh fold state per call; the input log is read-only.
 *
 * This spec machine-checks that contract: the log prefix is byte-identical
 * after compaction, growth is strictly append-only, the checkpoint is a NEW
 * event with the replacement marker and full source-event provenance, and the
 * trigger is the debt metric (token ratio), never wall-clock.
 */

import { describe, expect, it, vi } from 'vitest'
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
import {
  foldSurface,
  isAppendSurfaceEvent,
  isReplacementSurfaceEvent,
} from '@atlasai/atsh-session/surface'
import type { SessionEvent } from '@atlasai/atsh-session'
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

describe('derive-never-rewrite: the log is never rewritten', () => {
  it('leaves every pre-compaction event byte-identical after compaction', async () => {
    const compact = service(PRESSURE_CONFIG)
    const session = conversation(4)
    const before = session.events
    const beforeCount = before.length
    const preImage = JSON.stringify(before)

    const result = await compactIfNeeded(compact, session)
    expect(result).not.toBeNull()

    const after = session.events
    expect(after.length).toBe(beforeCount + 4)
    // Byte-for-byte: the serialized prefix is unchanged.
    expect(JSON.stringify(after.slice(0, beforeCount))).toBe(preImage)
    // Reference-for-reference: every pre-compaction event is the SAME frozen
    // object (deep-freeze at append makes mutation impossible and identity
    // provable).
    after.slice(0, beforeCount).forEach((event, index) => {
      expect(event).toBe(before[index])
    })
  })

  it('grows strictly by appending exactly start → summary → replacement → end', async () => {
    const compact = service(PRESSURE_CONFIG)
    const session = conversation(4)
    const beforeCount = session.events.length

    const result = await compactIfNeeded(compact, session)
    expect(result).not.toBeNull()

    const newEvents = session.events.slice(beforeCount)
    expect(newEvents.map(event => event.type)).toEqual([
      'compaction/start',
      'compaction/summary',
      'user/message',
      'compaction/end',
    ])
    // Contiguous seqs continuing the existing log; nothing renumbered.
    expect(newEvents.map(event => event.seq)).toEqual([
      beforeCount,
      beforeCount + 1,
      beforeCount + 2,
      beforeCount + 3,
    ])
    // The pre-existing tail event still sits at its original index with its
    // original seq; nothing was renumbered or removed.
    expect(session.events[beforeCount - 1]!.seq).toBe(beforeCount - 1)
    expect(session.events[beforeCount - 1]!.type).toBe('turn/start')
  })

  it('emits a NEW replacement event with surfaceOp replace and full provenance', async () => {
    const compact = service(PRESSURE_CONFIG)
    const session = conversation(4)
    const before = session.events
    const beforeCount = before.length
    // Copy: `surface.nodes` is the live fold-state array; compaction later
    // mutates it in place when the replacement is folded.
    const preSurface = [...session.surface.nodes]

    const result = await compactIfNeeded(compact, session)
    expect(result).not.toBeNull()
    const replacement = session.events[beforeCount + 2]
    expect(replacement).toBeDefined()
    expect(replacement!.type).toBe('user/message')

    // A NEW event: never seen in the pre-compaction log.
    expect(before.some(event => event === replacement)).toBe(false)
    expect(before.some(event => event.seq === replacement!.seq)).toBe(false)

    // The replacement marker with the exact shadowed range.
    expect(isAppendSurfaceEvent(replacement!)).toBe(false)
    expect(isReplacementSurfaceEvent(replacement!)).toBe(true)
    expect((replacement as SessionEvent<'user/message'>).surfaceOp).toEqual({
      op: 'replace',
      start: result!.shadowedRange.start,
      end: result!.shadowedRange.end,
    })
    // Full source-event provenance: start + summary + every shadowed node.
    expect((replacement as SessionEvent<'user/message'>).sourceEventSeqs).toEqual([
      result!.startSeq,
      result!.summarySeq,
      ...result!.shadowedSeqs,
    ])

    // The pure fold over the full log shows the checkpoint replacing exactly
    // the shadowed span; the retained tail survives untouched.
    const fold = foldSurface(session.events)
    const retained = preSurface.filter(seq => !result!.shadowedSeqs.includes(seq))
    expect(fold.nodes).toEqual([replacement!.seq, ...retained])
    expect(fold.replacements).toEqual([{
      seq: replacement!.seq,
      start: result!.shadowedRange.start,
      end: result!.shadowedRange.end,
      shadowedSeqs: [...result!.shadowedSeqs],
    }])
  })
})

describe('derive-never-rewrite: the trigger is the debt metric, not wall-clock', () => {
  it('below-threshold pressure compacts nothing', async () => {
    const compact = service(PRESSURE_CONFIG)
    // conversation(2) measures 362 estimated tokens < threshold 500
    // (0.5 ratio x 1000 context window): no debt, no compaction.
    const session = conversation(2)
    const beforeCount = session.events.length

    await expect(compactIfNeeded(compact, session)).resolves.toBeNull()
    expect(compact.calls).toHaveLength(0)
    expect(session.events.length).toBe(beforeCount)
  })

  it('above-threshold pressure compacts once through the transaction', async () => {
    const compact = service(PRESSURE_CONFIG)
    // conversation(4) measures 724 estimated tokens >= threshold 500: debt
    // exists, compaction fires immediately on the metric alone.
    const session = conversation(4)
    const beforeCount = session.events.length

    const result = await compactIfNeeded(compact, session)
    expect(result).not.toBeNull()
    expect(compact.calls).toHaveLength(1)
    expect(session.events.length).toBe(beforeCount + 4)
  })

  it('an elapsed hour changes nothing; only the debt metric compacts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const compact = service(PRESSURE_CONFIG)
      const below = conversation(2)
      const beforeCount = below.events.length

      // t=0: below threshold → no compaction.
      await expect(compactIfNeeded(compact, below)).resolves.toBeNull()
      // t=+1h: wall-clock elapsed, debt unchanged → still no compaction.
      vi.setSystemTime(Date.now() + 3_600_000)
      await expect(compactIfNeeded(compact, below)).resolves.toBeNull()
      expect(below.events.length).toBe(beforeCount)
      expect(compact.calls).toHaveLength(0)

      // A fresh above-threshold session compacts immediately at t=0 — the
      // trigger is the metric, never a timer.
      vi.setSystemTime(0)
      const above = conversation(4)
      await expect(compactIfNeeded(compact, above)).resolves.not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

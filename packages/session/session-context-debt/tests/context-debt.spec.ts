import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@atlasai/atsh-session'
import type { Session as SessionType } from '@atlasai/atsh-session'
import { CallId, createToolResultMessage, createUserMessage } from '@atlasai/atsh-llm'
import JsonlSessionPersistence from '@atlasai/atsh-session-persistence-jsonl'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContextDebtService } from '../src/index.ts'
import { detectStuffedContext, foldSummary, isFoldOnly, positionalPlacement } from '../src/fold.ts'
import type { CompactionPlan, ContextDebtConfig } from '../src/types.ts'

/**
 * Golden-rule regression suite for Fix 11 context-debt management: every
 * operation of this package is a read-only fold over committed events. The
 * JSONL log must stay byte-identical through scan/plan/report/reposition —
 * append-only is held, never a rewrite.
 */

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    await ctx.fiber.dispose()
  }
})

/** Mount the service (and nothing else) on a fresh context. */
async function mountService(config?: ContextDebtConfig): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(ContextDebtService, config)
  return ctx
}

/** A closed single-user turn with one text message. */
function appendClosedTurn(session: SessionType): void {
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'hello' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

/** A turn carrying one user message with the given text. */
function appendTurn(session: SessionType, turn: number, text: string): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/** A turn whose tool result carries a verbatim payload (non-essential context). */
function appendStuffedTurn(session: SessionType, turn: number, payload: string): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `request ${turn}` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('tool/result', {
    turn,
    step: 0,
    message: createToolResultMessage({
      callId: CallId(`call-${turn}`),
      content: [{ type: 'text', text: payload }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('session-context-debt — golden rule (never mutate model-visible history)', () => {
  it('fold-only compaction plan leaves the log byte-identical', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'context-debt-'))
    try {
      const ctx = new Context()
      contexts.push(ctx)
      await ctx.plugin(SessionStore)
      await ctx.plugin(JsonlSessionPersistence, { root: dir, compression: 'none' })
      await ctx.plugin(ContextDebtService)
      const session = ctx.sessions.create(SessionId('ctx-debt-a'))
      appendClosedTurn(session)
      await ctx.sessions.flush(session)

      const path = join(dir, '_no-cwd', 'ctx-debt-a', 'session.jsonl')
      const before = await readFile(path, 'utf8')
      const eventsBefore = JSON.stringify(session.events)

      const plan = ctx.contextDebt.plan(session, 400)
      expect(plan.foldOnly).toBe(true)
      expect(isFoldOnly(plan, session.events.at(-1)!.seq)).toBe(true)
      ctx.contextDebt.scan(session)
      ctx.contextDebt.report(plan)
      ctx.contextDebt.reposition(plan)

      await ctx.sessions.flush(session)
      const after = await readFile(path, 'utf8')
      expect(after).toEqual(before)
      expect(JSON.stringify(session.events)).toEqual(eventsBefore)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('derived summary replaces stuffed context in a fixture', async () => {
    const ctx = await mountService({ stuffedThresholdTokens: 1000 })
    const session = Session.create(SessionId('ctx-debt-b'))
    for (let turn = 1; turn <= 3; turn++) {
      appendStuffedTurn(session, turn, 'x'.repeat(2000))
    }
    const events = session.events
    const lastSeq = events.at(-1)!.seq

    const plan = ctx.contextDebt.plan(session, 10000)
    expect(plan.summary.length).toBeGreaterThan(0)
    expect(plan.foldOnly).toBe(true)
    expect(plan.shadowedTokenCount).toBeGreaterThan(0)
    for (const seq of plan.shadowedSeqs) {
      expect(seq).toBeGreaterThanOrEqual(0)
      expect(seq).toBeLessThanOrEqual(lastSeq)
    }
    expect(isFoldOnly(plan, lastSeq)).toBe(true)

    const stuffed = detectStuffedContext(events, 1000)
    expect(stuffed).not.toBeNull()
    expect(stuffed!.kind).toBe('stuffed')
    expect(stuffed!.measure).toBeGreaterThan(1000)
  })

  it('retrieval over stuffing: scan flags stuffed but never mutates', async () => {
    const ctx = await mountService({ stuffedThresholdTokens: 1000 })
    const session = Session.create(SessionId('ctx-debt-c'))
    for (let turn = 1; turn <= 3; turn++) {
      appendStuffedTurn(session, turn, 'y'.repeat(2000))
    }
    const before = JSON.stringify(session.events)

    const scan = ctx.contextDebt.scan(session)
    expect(scan.foldSeq).toBe(session.events.at(-1)!.seq)
    expect(scan.reports.some(report => report.kind === 'stuffed')).toBe(true)
    expect(JSON.stringify(session.events)).toEqual(before)
  })

  it('positional placement puts critical context at head/tail', async () => {
    const ctx = await mountService({ positionalHeadTokens: 30, positionalTailTokens: 30 })
    const session = Session.create(SessionId('ctx-debt-d'))
    appendTurn(session, 1, 'm1')
    appendTurn(session, 2, 'm2')
    appendTurn(session, 3, 'CRITICAL-MIDDLE ' + 'w'.repeat(1200))
    appendTurn(session, 4, 'm4')

    const events = session.events
    const reports = positionalPlacement(events, 30, 30)
    expect(reports.length).toBeGreaterThan(0)
    expect(reports.every(report => report.kind === 'positioned')).toBe(true)

    const plan = ctx.contextDebt.plan(session, 5000)
    const bands = ctx.contextDebt.reposition(plan)
    expect(bands.head.length).toBeGreaterThan(0)
    expect(bands.tail.length).toBeGreaterThan(0)
    const bandText = bands.head.join(' ') + bands.tail.join(' ')
    expect(bandText.length).toBeLessThan(plan.summary.length)
  })

  it('disabled config throws on scan/plan while reads work', async () => {
    const ctx = await mountService({ enabled: false })
    const session = Session.create(SessionId('ctx-debt-e'))
    appendTurn(session, 1, 'hello')

    expect(() => ctx.contextDebt.scan(session)).toThrow('context-debt disabled')
    expect(() => ctx.contextDebt.plan(session, 100)).toThrow('context-debt disabled')
    expect(session.events.length).toBeGreaterThan(0)
  })

  it('foldSummary respects budget', () => {
    expect(foldSummary([], 10)).toBe('')
    const session = Session.create(SessionId('ctx-debt-f'))
    appendTurn(session, 1, 'hello world this is a longer message '.repeat(20))
    const events = session.events

    const tiny = foldSummary(events, 10)
    expect(tiny.length).toBeGreaterThan(0)
    expect(Math.ceil(tiny.length / 4)).toBeLessThanOrEqual(10)

    const large = foldSummary(events, 1000)
    expect(Math.ceil(large.length / 4)).toBeLessThanOrEqual(1000)
    expect(large.length).toBeGreaterThan(tiny.length)
  })

  it('isFoldOnly rejects invented seqs', () => {
    const session = Session.create(SessionId('ctx-debt-g'))
    appendTurn(session, 1, 'hi')
    const lastSeq = session.events.at(-1)!.seq
    const good: CompactionPlan = {
      sessionId: session.id,
      summary: 'derived',
      shadowedRange: { start: 0, end: lastSeq },
      shadowedSeqs: [0, 1, 2],
      shadowedTokenCount: 3,
      foldOnly: true,
    }
    expect(isFoldOnly(good, lastSeq)).toBe(true)
    expect(isFoldOnly(good)).toBe(true)

    const invented: CompactionPlan = { ...good, shadowedSeqs: [9999] }
    expect(isFoldOnly(invented, lastSeq)).toBe(false)

    const rewritten = { ...good, foldOnly: false } as unknown as CompactionPlan
    expect(isFoldOnly(rewritten, lastSeq)).toBe(false)
  })
})

/**
 * Unit coverage for @atlasai/atsh-factory-judge: the unanimous three-panel
 * judge (ctx.factoryJudge) — decomposition veto, bounded replan loop, votes in
 * the event stream, and replan cost charged to accounting. All tests are
 * deterministic and make zero model calls.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AccountingService from '@atlasai/atsh-accounting'
import JudgeService, { type JudgeRequest, type JudgeVerdict, type JudgeVote } from '../src/index.ts'

/** A well-decomposed plan fixture: every task one verb + one object + a checkable verifies. */
const goodTasks = [
  { id: 'T1', verb: 'implement', object: 'the auth module', verifies: 'auth module exposes login()' },
  { id: 'T2', verb: 'add', object: 'unit tests', verifies: 'unit tests cover the auth module' },
  { id: 'T3', verb: 'write', object: 'docs', verifies: 'docs describe the auth module' },
]

/** A non-decomposed fixture: a single task whose verifies line is empty. */
const badTasks = [{ id: 'T1', verb: 'fix', object: 'everything', verifies: '' }]

describe('dsh-factory-judge', () => {
  let ctx: Context

  afterEach(async () => {
    await ctx.fiber.dispose()
  })

  it('judge panel PASS on a well-decomposed plan', async () => {
    ctx = new Context()
    const ballots: JudgeVote[] = []
    const verdicts: JudgeVerdict[] = []
    ctx.on('judge/ballot', vote => ballots.push(vote))
    ctx.on('judge/verdict', verdict => verdicts.push(verdict))
    await ctx.plugin(JudgeService, {})
    const verdict = ctx.factoryJudge.judge({
      judgmentId: 'j1',
      planId: 'p1',
      revision: 'r1',
      kind: 'plan',
      tasks: goodTasks,
    })
    expect(verdict.verdict).toBe('PASS')
    expect(verdict.ballots).toHaveLength(3)
    expect(verdict.ballots.every(vote => vote.vote === 'YES')).toBe(true)
    expect(verdict.replanCostCharged).toBe(0)
    expect(verdict.replansUsed).toBe(0)
    expect(ballots).toHaveLength(3)
    expect(ballots.every(vote => vote.vote === 'YES')).toBe(true)
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toEqual(verdict)
  })

  it('unanimity not averaging: one NO on a non-decomposed fixture → REPLAN', async () => {
    ctx = new Context()
    const replans: unknown[] = []
    ctx.on('judge/replan', payload => replans.push(payload))
    await ctx.plugin(JudgeService, {})
    const verdict = ctx.factoryJudge.judge({
      judgmentId: 'j2',
      planId: 'p2',
      revision: 'r1',
      kind: 'plan',
      tasks: badTasks,
    })
    expect(verdict.verdict).toBe('REPLAN')
    expect(verdict.ballots).toHaveLength(3)
    expect(verdict.ballots.some(vote =>
      vote.vote === 'NO' && vote.reasons.includes('task T1 lacks a non-empty verifies'),
    )).toBe(true)
    expect(verdict.replanCostCharged).toBe(1500)
    expect(replans).toHaveLength(1)
    expect(replans[0]).toMatchObject({ judgmentId: 'j2', planId: 'p2', kind: 'plan', cost: 1500 })
  })

  it('bounded replan loop: repeated NO exhausts budget → ESCALATE', async () => {
    ctx = new Context()
    await ctx.plugin(JudgeService, { maxReplans: 3, replanCost: 1500 })
    const request: JudgeRequest = { judgmentId: 'j3', planId: 'p3', revision: 'r1', kind: 'plan', tasks: badTasks }
    const replan = ctx.factoryJudge.judge(request)
    expect(replan.verdict).toBe('REPLAN')
    expect(replan.replansUsed).toBe(1)
    expect(replan.replansRemaining).toBe(2)
    expect(replan.replanCostCharged).toBe(1500)
    const replan2 = ctx.factoryJudge.judge(request)
    expect(replan2.verdict).toBe('REPLAN')
    expect(replan2.replansUsed).toBe(2)
    expect(replan2.replansRemaining).toBe(1)
    expect(replan2.replanCostCharged).toBe(1500)
    const replan3 = ctx.factoryJudge.judge(request)
    expect(replan3.verdict).toBe('REPLAN')
    expect(replan3.replansUsed).toBe(3)
    expect(replan3.replansRemaining).toBe(0)
    expect(replan3.replanCostCharged).toBe(1500)
    const escalate = ctx.factoryJudge.judge(request)
    expect(escalate.verdict).toBe('ESCALATE')
    expect(escalate.replansUsed).toBe(3)
    expect(escalate.replansRemaining).toBe(0)
    expect(escalate.replanCostCharged).toBe(0)
    expect(ctx.factoryJudge.replanState('j3')).toEqual({ replansUsed: 0, maxReplans: 3 })
  })

  it('replan cost in accounting', async () => {
    ctx = new Context()
    await ctx.plugin(AccountingService, { credits: 100 })
    await ctx.plugin(JudgeService, {})
    const planId = 'p4'
    const verdict = ctx.factoryJudge.judge({
      judgmentId: 'j4',
      planId,
      revision: 'r1',
      kind: 'plan',
      tasks: badTasks,
    })
    expect(verdict.verdict).toBe('REPLAN')
    expect(ctx.accounting.getBalance('default')).toBe(100 - 1500)
    const rows = ctx.accounting.listLedger(5)
    const charge = rows.find(row => row.reason === 'judge-replan')
    expect(charge).toBeDefined()
    expect(charge).toMatchObject({ kind: 'debit', amount: -1500 })
    expect(charge?.meta).toMatchObject({ planId })
  })

  it('completion gate: unapproved plan → NO, approved plan with evidence → PASS', async () => {
    ctx = new Context()
    await ctx.plugin(JudgeService, {})
    const completion = {
      judgmentId: 'j5a',
      planId: 'p5',
      revision: 'r1',
      kind: 'completion' as const,
      tasks: goodTasks,
      submission: { summary: 'auth module done', evidence: ['tests pass'], files: ['src/auth.ts'] },
    }
    const unapproved = ctx.factoryJudge.judge(completion)
    expect(unapproved.verdict).toBe('REPLAN')
    expect(unapproved.ballots.some(vote =>
      vote.vote === 'NO' && vote.reasons.includes('plan artifact not approved by panel'),
    )).toBe(true)
    const planVerdict = ctx.factoryJudge.judge({
      judgmentId: 'j5b',
      planId: 'p5',
      revision: 'r1',
      kind: 'plan',
      tasks: goodTasks,
    })
    expect(planVerdict.verdict).toBe('PASS')
    const approved = ctx.factoryJudge.judge(completion)
    expect(approved.verdict).toBe('PASS')
    expect(approved.ballots.every(vote => vote.vote === 'YES')).toBe(true)
    const noEvidence = ctx.factoryJudge.judge({
      ...completion,
      judgmentId: 'j5c',
      submission: { summary: 'auth module done', evidence: [], files: ['src/auth.ts'] },
    })
    expect(noEvidence.verdict).toBe('REPLAN')
    expect(noEvidence.ballots.some(vote =>
      vote.vote === 'NO' && vote.reasons.includes('self-declared completion without evidence'),
    )).toBe(true)
  })

  it('single-judge mode', async () => {
    ctx = new Context()
    await ctx.plugin(JudgeService, {})
    const single = ctx.factoryJudge.judge({
      judgmentId: 'j6',
      planId: 'p6',
      revision: 'r1',
      kind: 'plan',
      tasks: goodTasks,
      mode: 'single',
    })
    expect(single.mode).toBe('single')
    expect(single.ballots).toHaveLength(1)
    expect(single.ballots[0]?.role).toBe('decomposition')
    const panel = ctx.factoryJudge.judge({
      judgmentId: 'j7',
      planId: 'p7',
      revision: 'r1',
      kind: 'plan',
      tasks: goodTasks,
      mode: 'panel',
    })
    expect(panel.mode).toBe('panel')
    expect(panel.ballots).toHaveLength(3)
  })

  it('disabled config rejects judge() while reads work', async () => {
    ctx = new Context()
    await ctx.plugin(JudgeService, { enabled: false })
    expect(() => ctx.factoryJudge.judge({
      judgmentId: 'j8',
      planId: 'p8',
      revision: 'r1',
      kind: 'plan',
      tasks: goodTasks,
    })).toThrow('factory-judge disabled')
    expect(ctx.factoryJudge.isPlanApproved('p8')).toBe(false)
    expect(ctx.factoryJudge.replanState('j8')).toEqual({ replansUsed: 0, maxReplans: 3 })
  })

  it('malformed requests throw TypeError', async () => {
    ctx = new Context()
    await ctx.plugin(JudgeService, {})
    expect(() => ctx.factoryJudge.judge({
      judgmentId: '',
      planId: 'p9',
      revision: 'r1',
      kind: 'plan',
      tasks: goodTasks,
    })).toThrow(TypeError)
    expect(() => ctx.factoryJudge.judge({
      judgmentId: 'j9',
      planId: 'p9',
      revision: 'r1',
      kind: 'bogus' as never,
      tasks: goodTasks,
    })).toThrow(TypeError)
    expect(() => ctx.factoryJudge.judge({
      judgmentId: 'j9',
      planId: 'p9',
      revision: 'r1',
      kind: 'plan',
      tasks: [],
    })).toThrow(TypeError)
    expect(() => ctx.factoryJudge.judge({
      judgmentId: 'j9',
      planId: 'p9',
      revision: 'r1',
      kind: 'completion',
      tasks: goodTasks,
    })).toThrow(TypeError)
  })

  it('triage vote', async () => {
    ctx = new Context()
    await ctx.plugin(JudgeService, {})
    const noAction = ctx.factoryJudge.judge({
      judgmentId: 'j10a',
      planId: 'p10',
      revision: 'r1',
      kind: 'triage',
      tasks: goodTasks,
      triage: { failure: 'build broke', nextAction: '', evidence: ['build log'] },
    })
    expect(noAction.verdict).toBe('REPLAN')
    expect(noAction.ballots.some(vote =>
      vote.vote === 'NO' && vote.reasons.includes('triage lacks a next action'),
    )).toBe(true)
    const actionable = ctx.factoryJudge.judge({
      judgmentId: 'j10b',
      planId: 'p10',
      revision: 'r1',
      kind: 'triage',
      tasks: goodTasks,
      triage: { failure: 'build broke', nextAction: 'fix the tsconfig', evidence: ['build log'] },
    })
    expect(actionable.verdict).toBe('PASS')
    expect(actionable.ballots.every(vote => vote.vote === 'YES')).toBe(true)
  })
})

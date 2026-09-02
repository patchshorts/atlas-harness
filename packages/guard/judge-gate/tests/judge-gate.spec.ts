/**
 * Unit coverage for @atlasai/atsh-judge-gate: the three-panel judge gate
 * seam (ctx.judgeGate) — service surface, deterministic parser, and the
 * fail-closed admission round-trip with judge/ballot events collected.
 * Deterministic; zero model calls. Fixture-depth assertions (known-bad NO,
 * maximal unanimous PASS, completion/exit semantics) land in the T5/T6/T7
 * specs — this file grows with them.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import JudgeService, { type JudgeVote } from '@atlasai/atsh-factory-judge'
import JudgeGateService, { JudgeGateError, parsePlanTasks } from '../src/index.ts'

/** A well-decomposed plan fixture: every task one verb + one object + a checkable verifies. */
const goodPlan = [
  '1. [implement] the auth module — verifies: auth module exposes login()',
  '2. [add] unit tests — verifies: unit tests cover the auth module',
  '3. [write] docs — verifies: docs describe the auth module',
].join('\n')

/** A non-decomposed fixture: a single task whose verifies line is empty. */
const badPlan = '1. [fix] everything — verifies: '

/** Run a throwing call and return the caught error. */
function caughtBy(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to throw')
}

describe('dsh-judge-gate', () => {
  let ctx: Context

  afterEach(async () => {
    await ctx.fiber.dispose()
  })

  it('registers the service surface on ctx.judgeGate', async () => {
    ctx = new Context()
    await ctx.plugin(JudgeService, {})
    await ctx.plugin(JudgeGateService, {})
    expect(ctx.judgeGate.admitPlan).toBeTypeOf('function')
    expect(ctx.judgeGate.checkCompletion).toBeTypeOf('function')
    expect(ctx.judgeGate.reviewExit).toBeTypeOf('function')
  })

  it('parses the factory L5 row format deterministically', () => {
    const plan = [
      '3. [implement] judge-gate service — src/service.ts — ∥ — verifies: tsc -b passes',
      '1. [fix] everything — verifies: ',
    ].join('\n')
    const first = parsePlanTasks(plan)
    // Same markdown → same tasks, byte-stable.
    expect(parsePlanTasks(plan)).toEqual(first)
    expect(first).toEqual([
      { id: 'T3', verb: 'implement', object: 'judge-gate service', verifies: 'tsc -b passes' },
      { id: 'T1', verb: 'fix', object: 'everything', verifies: '' },
    ])
  })

  it('skips prose rows and keeps matched rows even with empty fields', () => {
    const plan = [
      '# A plan',
      'This paragraph is not a task row.',
      '2. [add] tests — verifies: tests run',
    ].join('\n')
    expect(parsePlanTasks(plan)).toEqual([
      { id: 'T2', verb: 'add', object: 'tests', verifies: 'tests run' },
    ])
  })

  it('rejects a non-decomposed plan at admission, recording NO ballots', async () => {
    ctx = new Context()
    const ballots: JudgeVote[] = []
    ctx.on('judge/ballot', vote => ballots.push(vote))
    await ctx.plugin(JudgeService, {})
    await ctx.plugin(JudgeGateService, {})
    const error = caughtBy(() =>
      ctx.judgeGate.admitPlan({ planId: 'p-bad', revision: 'r1', planMarkdown: badPlan }),
    ) as JudgeGateError
    expect(error).toBeInstanceOf(JudgeGateError)
    expect(error.name).toBe('JudgeGateError')
    expect(error.verdict.verdict).toBe('REPLAN')
    expect(error.verdict.ballots.some(vote => vote.vote === 'NO')).toBe(true)
    expect(error.reasons).toContain('task T1 lacks a non-empty verifies')
    expect(error.tasks).toEqual([{ id: 'T1', verb: 'fix', object: 'everything', verifies: '' }])
    // The ballot events ride the judge/* stream (gate adds none of its own).
    expect(ballots.some(vote => vote.vote === 'NO')).toBe(true)
    expect(ballots).toHaveLength(error.verdict.ballots.length)
  })

  it('admits a well-decomposed plan unanimously, recording 3 YES ballots', async () => {
    ctx = new Context()
    const ballots: JudgeVote[] = []
    ctx.on('judge/ballot', vote => ballots.push(vote))
    await ctx.plugin(JudgeService, {})
    await ctx.plugin(JudgeGateService, {})
    const verdict = ctx.judgeGate.admitPlan({ planId: 'p-good', revision: 'r1', planMarkdown: goodPlan })
    expect(verdict.verdict).toBe('PASS')
    expect(verdict.ballots).toHaveLength(3)
    // Unanimity, not averaging: every judge votes YES; any single NO would block.
    expect(verdict.ballots.every(vote => vote.vote === 'YES')).toBe(true)
    // The ballots ride the judge/* stream (gate adds none of its own).
    expect(ballots).toHaveLength(3)
    expect(ballots.every(vote => vote.vote === 'YES')).toBe(true)
  })

  it('bounds replans at maxReplans (default 2) before invoking the panel again', async () => {
    ctx = new Context()
    // The panel's own default budget is 3; the gate is the D2 N≤2 authority.
    await ctx.plugin(JudgeService, {})
    await ctx.plugin(JudgeGateService, {})
    const input = { planId: 'p-budget', planMarkdown: badPlan }
    const rejectAt = (revision: string): JudgeGateError =>
      caughtBy(() => ctx.judgeGate.admitPlan({ ...input, revision })) as JudgeGateError
    // Round 1: NO → REPLAN (replansUsed 1, budget remains).
    expect(rejectAt('r1').verdict.verdict).toBe('REPLAN')
    // Round 2: NO → REPLAN (replansUsed 2, budget spent).
    expect(rejectAt('r2').verdict.verdict).toBe('REPLAN')
    // Round 3: the gate's pre-check escalates without a new panel round.
    const escalated = rejectAt('r3')
    expect(escalated.verdict.verdict).toBe('ESCALATE')
    expect(escalated.verdict.ballots).toHaveLength(0)
    expect(escalated.reasons).toContain('replan budget exhausted: max 2 replans per judgment')
  })

  it('fails closed on a plan with no parseable task rows', async () => {
    ctx = new Context()
    await ctx.plugin(JudgeService, {})
    await ctx.plugin(JudgeGateService, {})
    const error = caughtBy(() =>
      ctx.judgeGate.admitPlan({ planId: 'p-none', revision: 'r1', planMarkdown: '# A plan\nJust prose.' }),
    ) as JudgeGateError
    expect(error).toBeInstanceOf(JudgeGateError)
    expect(error.reasons).toEqual(['plan has no tasks'])
    expect(error.verdict.verdict).toBe('REPLAN')
  })

  it('fails closed when the judge panel is not composed', async () => {
    ctx = new Context()
    await ctx.plugin(JudgeGateService, {})
    expect(() =>
      ctx.judgeGate.admitPlan({ planId: 'p-x', revision: 'r1', planMarkdown: goodPlan }),
    ).toThrow(/factoryJudge panel service is not composed/)
  })

  it('refuses to judge when disabled', async () => {
    ctx = new Context()
    await ctx.plugin(JudgeService, {})
    await ctx.plugin(JudgeGateService, { enabled: false })
    expect(() =>
      ctx.judgeGate.admitPlan({ planId: 'p-x', revision: 'r1', planMarkdown: goodPlan }),
    ).toThrow(/gate is disabled/)
  })

  // ── T7: completion + exit gates ────────────────────────────────────────
  // Completion/exit votes require a prior plan approval (S2): unapproved
  // planId → NO (fail closed, no fabricated ballots), approved plan with a
  // summary + evidence + files → PASS, evidence-less claims → NO. The same
  // verification contract applies at exit review (reviewExit).

  it('rejects a completion for a plan the panel never approved', async () => {
    ctx = new Context()
    await ctx.plugin(JudgeService, {})
    await ctx.plugin(JudgeGateService, {})
    const error = caughtBy(() =>
      ctx.judgeGate.checkCompletion({
        planId: 'p-never-approved',
        revision: 'r1',
        submission: { summary: 'all done', evidence: ['tests pass'], files: ['src/a.ts'] },
      }),
    ) as JudgeGateError
    expect(error).toBeInstanceOf(JudgeGateError)
    expect(error.name).toBe('JudgeGateError')
    expect(error.verdict.verdict).toBe('REPLAN')
    // Fail closed without fabricating ballots: the panel never ran this round.
    expect(error.verdict.ballots).toHaveLength(0)
    expect(error.reasons).toContain('plan artifact not admitted by the panel')
  })

  it('rejects a completion at a revision the panel never approved', async () => {
    ctx = new Context()
    await ctx.plugin(JudgeService, {})
    await ctx.plugin(JudgeGateService, {})
    ctx.judgeGate.admitPlan({ planId: 'p-rev', revision: 'r1', planMarkdown: goodPlan })
    const error = caughtBy(() =>
      ctx.judgeGate.checkCompletion({
        planId: 'p-rev',
        revision: 'r2',
        submission: { summary: 'all done', evidence: ['tests pass'], files: ['src/a.ts'] },
      }),
    ) as JudgeGateError
    expect(error).toBeInstanceOf(JudgeGateError)
    expect(error.verdict.verdict).toBe('REPLAN')
    expect(error.reasons).toContain('plan artifact not approved at revision r2')
  })

  it('passes a completion when the plan was approved and the claim is evidence-backed', async () => {
    ctx = new Context()
    const ballots: JudgeVote[] = []
    ctx.on('judge/ballot', vote => ballots.push(vote))
    await ctx.plugin(JudgeService, {})
    await ctx.plugin(JudgeGateService, {})
    ctx.judgeGate.admitPlan({ planId: 'p-approved', revision: 'r1', planMarkdown: goodPlan })
    const verdict = ctx.judgeGate.checkCompletion({
      planId: 'p-approved',
      revision: 'r1',
      submission: {
        summary: 'auth module implemented, unit-tested, and documented',
        evidence: ['pnpm test:unit passes', 'manual login flow verified'],
        files: ['src/auth.ts', 'tests/auth.spec.ts', 'docs/auth.md'],
      },
    })
    expect(verdict.verdict).toBe('PASS')
    expect(verdict.ballots).toHaveLength(3)
    // Unanimity, not averaging: every judge votes YES on the evidence-backed claim.
    expect(verdict.ballots.every(vote => vote.vote === 'YES')).toBe(true)
    // The completion ballots ride the judge/* stream (gate adds none of its own).
    expect(ballots.filter(vote => vote.kind === 'completion')).toHaveLength(3)
    expect(ballots.filter(vote => vote.kind === 'completion').every(vote => vote.vote === 'YES')).toBe(true)
  })

  it('rejects an evidence-less completion despite an approved plan', async () => {
    ctx = new Context()
    const ballots: JudgeVote[] = []
    ctx.on('judge/ballot', vote => ballots.push(vote))
    await ctx.plugin(JudgeService, {})
    await ctx.plugin(JudgeGateService, {})
    ctx.judgeGate.admitPlan({ planId: 'p-naked', revision: 'r1', planMarkdown: goodPlan })
    const error = caughtBy(() =>
      ctx.judgeGate.checkCompletion({
        planId: 'p-naked',
        revision: 'r1',
        submission: { summary: 'trust me', evidence: [], files: ['src/auth.ts'] },
      }),
    ) as JudgeGateError
    expect(error).toBeInstanceOf(JudgeGateError)
    expect(error.verdict.verdict).toBe('REPLAN')
    expect(error.reasons).toContain('self-declared completion without evidence')
    // The claim WAS judged: the verification role casts a real NO ballot.
    expect(ballots.filter(vote => vote.kind === 'completion').some(vote => vote.vote === 'NO')).toBe(true)
  })

  it('applies the same evidence gate at exit review', async () => {
    ctx = new Context()
    await ctx.plugin(JudgeService, {})
    await ctx.plugin(JudgeGateService, {})
    ctx.judgeGate.admitPlan({ planId: 'p-exit', revision: 'r1', planMarkdown: goodPlan })
    const passed = ctx.judgeGate.reviewExit({
      planId: 'p-exit',
      revision: 'r1',
      submission: {
        summary: 'all three tasks complete',
        evidence: ['targeted suite green'],
        files: ['src/auth.ts'],
      },
    })
    expect(passed.verdict).toBe('PASS')
    expect(passed.ballots.every(vote => vote.vote === 'YES')).toBe(true)
    const error = caughtBy(() =>
      ctx.judgeGate.reviewExit({
        planId: 'p-exit',
        revision: 'r1',
        submission: { summary: 'done', evidence: ['trust me'], files: [] },
      }),
    ) as JudgeGateError
    expect(error).toBeInstanceOf(JudgeGateError)
    expect(error.verdict.verdict).toBe('REPLAN')
    expect(error.reasons).toContain('self-declared completion without files')
  })
})

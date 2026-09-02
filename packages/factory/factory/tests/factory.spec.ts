/**
 * Unit coverage for @atlasai/atsh-factory: disabled config rejects
 * contract registration while reads still work, contract validation rejects
 * malformed plans, the deterministic BAR judge returns the exact PASS/FAIL
 * verdict shapes, contract scoring aggregates NOT_SUBMITTED tasks, and the
 * planner/developer/critic role-objective builders produce normalized
 * objectives or throw TypeError.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import FactoryService, { type FactoryConfig } from '../src/index.ts'
import {
  criticObjective,
  developerObjective,
  plannerObjective,
} from '../src/index.ts'
import type { BarSubmission, FactoryPlanTask } from '../src/index.ts'

/** Mount the factory service on a fresh context. */
async function mount(config: FactoryConfig = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(FactoryService, config)
  return ctx
}

/** A valid two-task plan contract for scoring tests. */
const CONTRACT: FactoryPlanTask[] = [
  { id: 'T1', verb: 'add', object: 'packages/factory', verifies: 'package builds and tests pass' },
  { id: 'T2', verb: 'compose', object: 'preset rows', verifies: 'diff shows ADDED lines only' },
]

/** A valid PASS-shaped submission for T1. */
const PASS_SUBMISSION: BarSubmission = {
  taskId: 'T1',
  summary: 'Landed the factory package',
  evidence: ['vitest 9/9', 'tsc -b exit 0'],
  files: ['packages/factory/factory/src/service.ts'],
}

describe('dsh-factory', () => {
  afterEach(() => {
    // Fresh context per test; nothing else to reset.
  })

  it('disabled config rejects registerPlanContract while reads still work', async () => {
    const ctx = await mount({ enabled: false })
    expect(() => { ctx.factory.registerPlanContract('p1', CONTRACT) }).toThrow('factory disabled')
    expect(ctx.factory.getPlanContract('p1')).toBeUndefined()
    expect(ctx.factory.listPlanIds()).toEqual([])
    await ctx.fiber.dispose()
  })

  it('registerPlanContract stores the contract and emits factory/contract-registered', async () => {
    const ctx = await mount()
    const payloads: Array<{ planId: string; count: number }> = []
    ctx.on('factory/contract-registered', (payload) => {
      payloads.push(payload)
    })
    ctx.factory.registerPlanContract('p1', CONTRACT)
    expect(payloads).toEqual([{ planId: 'p1', count: 2 }])
    const read = ctx.factory.getPlanContract('p1')
    expect(read).toEqual(CONTRACT)
    expect(read).not.toBe(ctx.factory.getPlanContract('p1'))
    expect(ctx.factory.listPlanIds()).toEqual(['p1'])
    await ctx.fiber.dispose()
  })

  it('registerPlanContract rejects empty arrays, malformed fields, duplicates, and over-limit plans', async () => {
    const ctx = await mount({ maxPlanTasks: 2 })
    expect(() => { ctx.factory.registerPlanContract('p1', []) }).toThrow('non-empty array')
    expect(() => { ctx.factory.registerPlanContract('p1', [{ id: 'T1', verb: 'add', object: 'x', verifies: '' }]) })
      .toThrow('non-empty normalized id/verb/object/verifies')
    expect(() => { ctx.factory.registerPlanContract('p1', [
      { id: 'T1', verb: 'add', object: 'x', verifies: 'v' },
      { id: 'T1', verb: 'fix', object: 'y', verifies: 'v' },
    ]) }).toThrow('duplicate task id')
    expect(() => { ctx.factory.registerPlanContract('p1', [
      ...CONTRACT,
      { id: 'T3', verb: 'add', object: 'z', verifies: 'v' },
    ]) }).toThrow('maxPlanTasks')
    expect(() => { ctx.factory.registerPlanContract('', CONTRACT) }).toThrow('planId must be')
    await ctx.fiber.dispose()
  })

  it('scoreTask returns PASS with all three passedChecks and empty reasons', async () => {
    const ctx = await mount()
    ctx.factory.registerPlanContract('p1', CONTRACT)
    const verdict = ctx.factory.scoreTask('p1', PASS_SUBMISSION)
    expect(verdict).toEqual({
      taskId: 'T1',
      status: 'PASS',
      passedChecks: ['summary present', 'evidence present (2 items)', 'files present (1 paths)'],
      reasons: [],
    })
    await ctx.fiber.dispose()
  })

  it('scoreTask returns FAIL with the exact reason per failed clause', async () => {
    const ctx = await mount()
    ctx.factory.registerPlanContract('p1', CONTRACT)
    expect(ctx.factory.scoreTask('p1', { ...PASS_SUBMISSION, summary: '   ' }).reasons)
      .toEqual(['summary must be a non-empty normalized string'])
    expect(ctx.factory.scoreTask('p1', { ...PASS_SUBMISSION, evidence: [] }).reasons)
      .toEqual(['evidence must be a non-empty array of normalized strings'])
    expect(ctx.factory.scoreTask('p1', { ...PASS_SUBMISSION, files: [] }).reasons)
      .toEqual(['files must be a non-empty array of normalized strings'])
    expect(ctx.factory.scoreTask('p1', { ...PASS_SUBMISSION, evidence: ['ok', '  '] }).status).toBe('FAIL')
    const allFail = ctx.factory.scoreTask('p1', { taskId: 'T1', summary: '', evidence: [], files: [] })
    expect(allFail.status).toBe('FAIL')
    expect(allFail.passedChecks).toEqual([])
    expect(allFail.reasons).toHaveLength(3)
    await ctx.fiber.dispose()
  })

  it('scoreTask throws for unknown plan contracts and unknown task ids', async () => {
    const ctx = await mount()
    ctx.factory.registerPlanContract('p1', CONTRACT)
    expect(() => ctx.factory.scoreTask('nope', PASS_SUBMISSION)).toThrow('unknown plan contract "nope"')
    expect(() => ctx.factory.scoreTask('p1', { ...PASS_SUBMISSION, taskId: 'T99' }))
      .toThrow('task "T99" is not in plan contract "p1"')
    await ctx.fiber.dispose()
  })

  it('scoreContract counts submitted/passed/failed and NOT_SUBMITTED tasks', async () => {
    const ctx = await mount()
    ctx.factory.registerPlanContract('p1', CONTRACT)
    const partial = ctx.factory.scoreContract('p1', [PASS_SUBMISSION])
    expect(partial).toEqual({
      planId: 'p1',
      total: 2,
      submitted: 1,
      passed: 1,
      failed: 0,
      verdict: 'FAIL',
    })
    const allPass = ctx.factory.scoreContract('p1', [
      PASS_SUBMISSION,
      { taskId: 'T2', summary: 'composed', evidence: ['diff clean'], files: ['mount.ts'] },
    ])
    expect(allPass.verdict).toBe('ALL_PASS')
    const oneFail = ctx.factory.scoreContract('p1', [
      PASS_SUBMISSION,
      { taskId: 'T2', summary: 'composed', evidence: [], files: ['mount.ts'] },
    ])
    expect(oneFail.verdict).toBe('FAIL')
    expect(oneFail.failed).toBe(1)
    await ctx.fiber.dispose()
  })

  it('role-objective builders produce normalized objectives containing role, scope, and verifies', async () => {
    const planner = plannerObjective({ scope: 'the referral system', constraints: ['no staging'] })
    expect(planner).toContain('planner')
    expect(planner).toContain('the referral system')
    expect(planner).toContain('L5 atomic tasks')
    expect(planner).toBe(planner.trim())
    const task = CONTRACT[0]!
    const developer = developerObjective(task, { workspace: '/work' })
    expect(developer).toContain('developer')
    expect(developer).toContain(task.verb)
    expect(developer).toContain(task.object)
    expect(developer).toContain(task.verifies)
    expect(developer).toContain('/work')
    const critic = criticObjective(task, { summary: 'did the thing', files: ['a.ts', 'b.ts'] })
    expect(critic).toContain('critic')
    expect(critic).toContain(task.id)
    expect(critic).toContain(task.verifies)
    expect(critic).toContain('did the thing')
    expect(critic).toContain('a.ts')
  })

  it('role-objective builders throw TypeError on invalid inputs', async () => {
    expect(() => plannerObjective({ scope: '' })).toThrow('planner scope must be')
    expect(() => plannerObjective({ scope: 'x', constraints: ['ok', ' '] }))
      .toThrow('planner constraints must be')
    expect(() => developerObjective({ id: 'T1', verb: '', object: 'x', verifies: 'v' }))
      .toThrow('developer task fields must be')
    expect(() => criticObjective(CONTRACT[0]!, { summary: '', files: ['a.ts'] }))
      .toThrow('critic work summary must be')
    expect(() => criticObjective(CONTRACT[0]!, { summary: 's', files: [''] }))
      .toThrow('critic work files must be')
  })

  it('buildRoleObjective dispatches to the pure builders and rejects unknown roles', async () => {
    const ctx = await mount()
    expect(ctx.factory.buildRoleObjective('planner', { scope: 'scope' })).toContain('planner')
    expect(ctx.factory.buildRoleObjective('developer', CONTRACT[0]!)).toContain('developer')
    expect(ctx.factory.buildRoleObjective('critic', CONTRACT[0]!, { summary: 's', files: ['a'] }))
      .toContain('critic')
    // @ts-expect-error unknown role is rejected at runtime
    expect(() => ctx.factory.buildRoleObjective('janitor', { scope: 'x' })).toThrow('unknown role')
    await ctx.fiber.dispose()
  })
})

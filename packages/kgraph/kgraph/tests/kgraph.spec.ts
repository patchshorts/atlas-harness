import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as kgraph from '../src/index.ts'
import { SqliteKGraphStore } from '../src/index.ts'
import type { SessionLogReader } from '../src/index.ts'

/** Mount the kgraph plugin on a fresh context (sqlite `:memory:` unless overridden). */
async function setup(config: kgraph.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(kgraph, config)
  return ctx
}

describe('dsh-kgraph sqlite backend', () => {
  it('registers ctx.kgraph with the default sqlite backend when no config is given', async () => {
    const ctx = await setup()
    expect(ctx.kgraph).toBeDefined()
    expect(ctx.kgraph).toBeInstanceOf(SqliteKGraphStore)
    await expect(ctx.kgraph.getStats()).resolves.toEqual({
      objectives: 0,
      keyResults: 0,
      evidence: 0,
      sessionsIngested: 0,
    })
  })

  it('upserts an objective and lists it back with fields preserved', async () => {
    const ctx = await setup({ sqlite: { path: ':memory:' } })
    const objective = await ctx.kgraph.upsertObjective({ name: 'launch the new product line', description: 'first release' })
    expect(objective.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(objective.name).toBe('launch the new product line')
    expect(objective.description).toBe('first release')
    expect(objective.status).toBe('active')
    expect(objective.keyResults).toEqual([])

    const objectives = await ctx.kgraph.listObjectives()
    expect(objectives).toHaveLength(1)
    expect(objectives[0]!.id).toBe(objective.id)
  })

  it('updates an existing objective when id is given', async () => {
    const ctx = await setup({ sqlite: { path: ':memory:' } })
    const created = await ctx.kgraph.upsertObjective({ name: 'original name' })
    const updated = await ctx.kgraph.upsertObjective({ id: created.id, name: 'renamed objective' })
    expect(updated.id).toBe(created.id)
    expect(updated.name).toBe('renamed objective')
    const objectives = await ctx.kgraph.listObjectives()
    expect(objectives).toHaveLength(1)
    expect(objectives[0]!.name).toBe('renamed objective')
  })

  it('adds a key result and evidence rows and counts them', async () => {
    const ctx = await setup({ sqlite: { path: ':memory:' } })
    const objective = await ctx.kgraph.upsertObjective({ name: 'ship the platform' })
    const kr = await ctx.kgraph.addKeyResult({ objectiveId: objective.id, name: '100 paying users', metric: 'users' })
    expect(kr.objectiveId).toBe(objective.id)
    expect(kr.status).toBe('on-track')

    const evidence = await ctx.kgraph.addEvidence({
      objectiveId: objective.id,
      krId: kr.id,
      sessionId: 'sess-1',
      seq: 7,
      eventType: 'assistant/message',
      excerpt: 'completed the onboarding flow',
      time: 1000,
    })
    expect(evidence.sessionId).toBe('sess-1')
    expect(evidence.seq).toBe(7)

    const backend = ctx.kgraph as SqliteKGraphStore
    const objectives = backend.db.prepare('SELECT COUNT(*) AS n FROM kgraph_objectives').get() as { n: number }
    const keyResults = backend.db.prepare('SELECT COUNT(*) AS n FROM kgraph_key_results').get() as { n: number }
    const evidenceRows = backend.db.prepare('SELECT COUNT(*) AS n FROM kgraph_evidence').get() as { n: number }
    expect(objectives.n).toBe(1)
    expect(keyResults.n).toBe(1)
    expect(evidenceRows.n).toBe(1)

    await expect(ctx.kgraph.getStats()).resolves.toEqual({
      objectives: 1,
      keyResults: 1,
      evidence: 1,
      sessionsIngested: 1,
    })
  })

  it('builds a graph from a session log via the reader seam and is idempotent', async () => {
    const reader: SessionLogReader = async () => ({
      events: [
        { seq: 1, time: 1, type: 'user/message', data: { content: 'launch the new product line' } },
        { seq: 2, time: 2, type: 'assistant/message', data: { content: 'drafted the launch plan' } },
      ],
    })
    const ctx = await setup({ sqlite: { path: ':memory:' }, reader })
    const first = await ctx.kgraph.buildGraphFromSession('sess-build')
    expect(first).toEqual({ sessionId: 'sess-build', objectivesCreated: 1, evidenceAdded: 1 })

    const objectives = await ctx.kgraph.listObjectives()
    expect(objectives).toHaveLength(1)
    expect(objectives[0]!.name).toBe('launch the new product line')

    const stats = await ctx.kgraph.getStats()
    expect(stats.objectives).toBe(1)
    expect(stats.evidence).toBe(1)
    expect(stats.sessionsIngested).toBe(1)

    // Idempotent replay: nothing duplicates.
    const second = await ctx.kgraph.buildGraphFromSession('sess-build')
    expect(second).toEqual({ sessionId: 'sess-build', objectivesCreated: 0, evidenceAdded: 0 })
    const after = await ctx.kgraph.getStats()
    expect(after.objectives).toBe(1)
    expect(after.evidence).toBe(1)
  })

  it('returns a zero result when no reader and no sessionQuery service are available', async () => {
    const ctx = await setup({ sqlite: { path: ':memory:' } })
    await expect(ctx.kgraph.buildGraphFromSession('sess-null')).resolves.toEqual({
      sessionId: 'sess-null',
      objectivesCreated: 0,
      evidenceAdded: 0,
    })
  })
})

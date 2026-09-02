import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@atlasai/atsh-llm'
import SystemPrompt from '@atlasai/atsh-system-prompt'
import ToolRuntime from '@atlasai/atsh-tools'
// The kgraph plugin is imported by relative source path: the workspace glob for the new
// `kgraph` group is not (yet) in tsconfig.base.json's dsh-* path map, so package-name
// resolution would fall through to an unbuilt lib/. Relative is deliberate and additive.
import * as kgraph from '../../kgraph/src/index.ts'
import type { SqliteKGraphStore } from '../../kgraph/src/index.ts'
import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** Mount the real plugin body: system prompt, tool runtime, sqlite kgraph, and the tools. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(kgraph, { sqlite: { path: ':memory:' } })
  await ctx.plugin(tool, {})
  return ctx
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
  })
}

describe('dsh-tool-kgraph', () => {
  it('registers kgraph_upsert_objective, kgraph_record_evidence, and kgraph_query on ctx.tools', async () => {
    const ctx = await setup()
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('kgraph_upsert_objective')
    expect(names).toContain('kgraph_record_evidence')
    expect(names).toContain('kgraph_query')
  })

  it('round-trips an objective through kgraph_upsert_objective and kgraph_query', async () => {
    const ctx = await setup()
    const upsert = await call(ctx, 'kgraph_upsert_objective', { name: 'ship the platform' })
    expect(upsert.isError).toBe(false)
    if (upsert.isError) throw new Error('expected kgraph_upsert_objective success')
    const id = (upsert.value as { id: string }).id
    expect(id).toBeTruthy()

    const query = await call(ctx, 'kgraph_query', {})
    expect(query.isError).toBe(false)
    if (query.isError) throw new Error('expected kgraph_query success')
    const objectives = (query.value as { objectives: { id: string; name: string }[] }).objectives
    expect(objectives).toHaveLength(1)
    expect(objectives[0]!.id).toBe(id)
    expect(objectives[0]!.name).toBe('ship the platform')
  })

  it('records evidence against an objective and the store count grows', async () => {
    const ctx = await setup()
    const upsert = await call(ctx, 'kgraph_upsert_objective', { name: 'grow revenue' })
    if (upsert.isError) throw new Error('expected upsert success')
    const id = (upsert.value as { id: string }).id

    const record = await call(ctx, 'kgraph_record_evidence', { objectiveId: id, note: 'signed the first enterprise deal' })
    expect(record.isError).toBe(false)
    if (record.isError) throw new Error('expected kgraph_record_evidence success')
    expect((record.value as { objectiveId: string }).objectiveId).toBe(id)

    const backend = ctx.kgraph as SqliteKGraphStore
    const row = backend.db.prepare('SELECT COUNT(*) AS n FROM kgraph_evidence').get() as { n: number }
    expect(row.n).toBe(1)
  })
})

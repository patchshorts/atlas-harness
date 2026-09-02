import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memory from '@atlasai/atsh-memory/src/index.ts'
import SystemPrompt from '@atlasai/atsh-system-prompt'
import PromptCorpusService from '@atlasai/atsh-prompt-corpus'
import PromptLumeService, { TASK_ALIGNED_SECTION } from '../src/index.ts'
import type { PromptLumeCostRecord } from '../src/cost.ts'
import { CostSidecar, estimateTokens } from '../src/cost.ts'

const SKILLS_DOC = [
  '# Bash Skills',
  '',
  'You can run bash commands in a sandboxed shell.',
  '',
  '## Safety',
  '',
  'Never expose secrets with {{credential.name}}.',
  '',
  '## Tools',
  '',
  'Use the terminal tool for shell work.',
].join('\n')

/** Mount the real SQLite memory + prompt-corpus + system-prompt + prompt-lume. */
async function setup(config: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
  await ctx.plugin(PromptCorpusService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(PromptLumeService, config)
  return ctx
}

describe('prompt-lume cost sidecar (S6)', () => {
  it('estimates tokens under the fixed 4-char density', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })

  it('pure sidecar records cache-hit only after a prior call', () => {
    const sidecar = new CostSidecar()
    const first = sidecar.record('core one', 'region one', 4096)
    expect(first.callCount).toBe(1)
    expect(first.cacheHit).toBe(false)

    const second = sidecar.record('core one', 'region two', 4096)
    expect(second.callCount).toBe(2)
    expect(second.cacheHit).toBe(true)

    const summary = sidecar.summary()
    expect(summary.calls).toBe(2)
    expect(summary.cacheHits).toBe(1)
    expect(summary.cacheMisses).toBe(1)
  })

  it('emits a cost record with input tokens and budget on a live assemble call', async () => {
    const ctx = await setup({ budgetBytes: 2048 })
    await ctx.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills', scope: 'tooling' })

    const records: PromptLumeCostRecord[] = []
    ctx.on('prompt-lume/cost', (record) => { records.push(record) })

    ctx.promptLume.primeTurn({ intent: 'how do I run a bash command', kind: 'tool' })
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()

    expect(records).toHaveLength(1)
    const record = records[0]!
    expect(record.callCount).toBe(1)
    expect(record.cacheHit).toBe(false)
    expect(record.coreTokens).toBeGreaterThan(0)
    expect(record.regionTokens).toBeGreaterThan(0)
    expect(record.inputTokens).toBe(record.coreTokens + record.regionTokens)
    expect(record.budgetBytes).toBe(2048)
    expect(record.regionBytes).toBeGreaterThan(0)
    expect(record.regionBytes).toBeLessThanOrEqual(2048)
  })

  it('marks the second turn as a cache hit when the core is byte-identical', async () => {
    const ctx = await setup({ budgetBytes: 2048 })
    await ctx.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills', scope: 'tooling' })

    const records: PromptLumeCostRecord[] = []
    ctx.on('prompt-lume/cost', (record) => { records.push(record) })

    ctx.promptLume.primeTurn({ intent: 'how do I run a bash command', kind: 'tool' })
    await ctx.systemPrompt.assemble()
    ctx.promptLume.primeTurn({ intent: 'how do I use the terminal tool', kind: 'tool' })
    await ctx.systemPrompt.assemble()

    expect(records).toHaveLength(2)
    expect(records[0]!.cacheHit).toBe(false)
    // Core is byte-identical across turns → provider prompt-cache read path.
    expect(records[1]!.cacheHit).toBe(true)
    expect(records[1]!.coreTokens).toBe(records[0]!.coreTokens)

    const summary = ctx.promptLume.costSummary()
    expect(summary.calls).toBe(2)
    expect(summary.cacheHits).toBe(1)
    expect(summary.cacheMisses).toBe(1)
  })

  it('emits a core-only record (regionTokens 0) when retrieval yields nothing', async () => {
    const ctx = await setup({ budgetBytes: 2048 })
    // No corpus ingested → recall returns nothing → core-only assembly.

    const records: PromptLumeCostRecord[] = []
    ctx.on('prompt-lume/cost', (record) => { records.push(record) })

    ctx.promptLume.primeTurn({ intent: 'unrelated query with no corpus', kind: 'general' })
    const assembly = await ctx.systemPrompt.assemble()

    expect(assembly.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()
    expect(records).toHaveLength(1)
    expect(records[0]!.regionTokens).toBe(0)
    expect(records[0]!.regionBytes).toBe(0)
    expect(records[0]!.coreTokens).toBeGreaterThan(0)
    expect(records[0]!.inputTokens).toBe(records[0]!.coreTokens)
  })
})

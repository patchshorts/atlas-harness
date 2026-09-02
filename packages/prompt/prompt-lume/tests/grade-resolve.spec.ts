import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memory from '@atlasai/atsh-memory/src/index.ts'
import SystemPrompt from '@atlasai/atsh-system-prompt'
import PromptCorpusService from '@atlasai/atsh-prompt-corpus'
import PromptLumeService, { TASK_ALIGNED_SECTION, resolveGradeKnobs } from '../src/index.ts'
import { GRADE_HOOKS } from '../src/grade.ts'
import type { GradeHookWidth, ReductionGrade } from '../src/grade.ts'
import { emittedRegionText } from './emit-helper.ts'

const GRADE4: ReductionGrade[] = ['low', 'med', 'high', 'xhigh']

/** Mount prompt-lume with a grade through the real Config schema (fiber resolveConfig path). */
async function mountWithGrade(grade?: ReductionGrade): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
  await ctx.plugin(PromptCorpusService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(PromptLumeService, grade ? { reducerGrade: grade } : undefined)
  return ctx
}

describe('prompt-lume grade → knob resolution (T8)', () => {
  for (const grade of GRADE4) {
    it(`resolves ${grade} to its hook-width row`, async () => {
      const knobs = resolveGradeKnobs(grade)
      const hook: GradeHookWidth = GRADE_HOOKS[grade]
      expect(knobs).toEqual({
        topK: hook.chunkCommitCount,
        budgetBytes: hook.regionByteBudget,
        rerankThreshold: hook.rankingCutoff,
        searchSpan: hook.corpusSearchSpan,
      })
    })
  }

  it('widens monotonically low → med → high → xhigh (knobs), the complexity-matched hook thesis', () => {
    const sel = resolveGradeKnobs
    // Narrower hook = less retained context at the low end.
    expect(sel('low').topK).toBeLessThan(sel('xhigh').topK)
    expect(sel('med').topK).toBeLessThan(sel('xhigh').topK)
    expect(sel('high').topK).toBeLessThan(sel('xhigh').topK)
    // Byte budget widens: low retains the least context.
    expect(sel('low').budgetBytes).toBeLessThan(sel('med').budgetBytes)
    expect(sel('med').budgetBytes).toBeLessThan(sel('high').budgetBytes)
    expect(sel('high').budgetBytes).toBeLessThan(sel('xhigh').budgetBytes)
    // Ranking cutoff falls = more germane chunks clear commitment.
    expect(sel('low').rerankThreshold).toBeGreaterThan(sel('xhigh').rerankThreshold)
    // Search span widens with the grade.
    expect(sel('low').searchSpan).toBeLessThan(sel('xhigh').searchSpan)
  })

  it('keeps every grade behind a wall (no zero-grade: budgetBytes > 0)', () => {
    for (const grade of GRADE4) {
      const knobs = resolveGradeKnobs(grade)
      expect(knobs.budgetBytes).toBeGreaterThan(0)
      expect(knobs.topK).toBeGreaterThanOrEqual(1)
    }
  })

  it('wires the grade through the real Config schema: constructor honors reducerGrade', async () => {
    // `xhigh` is the permissive grade (cutoff 0.3, widest hook): a matching
    // doc clears it, so a region is injected — proving reducerGrade survived
    // the fiber resolveConfig (schema) path into the constructor knobs. The
    // per-grade knob VALUES are asserted by resolveGradeKnobs above; this is
    // the end-to-end wiring proof.
    const xhighKnobs = resolveGradeKnobs('xhigh')
    const ctx = await mountWithGrade('xhigh')
    await ctx.promptCorpus.ingest('# Bash Skills\n\nYou can run bash in a sandboxed shell.', { corpus: 'skills' })
    ctx.promptLume.primeTurn({ intent: 'run bash command in sandbox', kind: 'tool' })
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()
    const regionText = emittedRegionText(ctx)
    // The byte-stable core is untouched while a finite region is staged.
    expect(regionText).not.toBe('')
    // The resolved xhigh-grade budget bounds the injected region.
    expect(Buffer.byteLength(regionText, 'utf8')).toBeLessThanOrEqual(xhighKnobs.budgetBytes)
    // Provenance intact at every grade.
    expect(regionText).toContain('[prompt-lume]')
  })

  it('mounts with no grade (scalar knobs unchanged)', async () => {
    const ctx = await mountWithGrade()
    expect(ctx.promptLume).toBeDefined()
  })
})

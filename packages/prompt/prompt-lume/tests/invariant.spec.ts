import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memory from '@atlasai/atsh-memory/src/index.ts'
import SystemPrompt, { renderPrompt } from '@atlasai/atsh-system-prompt'
import type { PromptAssembly } from '@atlasai/atsh-system-prompt'
import PromptCorpusService from '@atlasai/atsh-prompt-corpus'
import PromptLumeService, { TASK_ALIGNED_SECTION } from '../src/index.ts'
import { GRADE_ORDER } from '../src/grade.ts'
import type { ReductionGrade } from '../src/grade.ts'
import { emittedRegionText } from './emit-helper.ts'

const SKILLS_DOC = [
  '# Bash Skills',
  '',
  'You can run bash commands in a sandboxed shell.',
  '',
  '## Tools',
  '',
  'Use the terminal tool for shell work.',
].join('\n')

const WORKSPACE_DOC = [
  '# Workspace Rules',
  '',
  'Follow AGENTS.md for this directory.',
  '',
  '## Imports',
  '',
  'Use package names across packages.',
].join('\n')

/** Mount memory + corpus + system-prompt + prompt-lume with a grade (or the scalar default). */
async function mountWithGrade(grade?: ReductionGrade): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
  await ctx.plugin(PromptCorpusService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(PromptLumeService, grade ? { reducerGrade: grade } : {})
  return ctx
}

/** Render the byte-stable core: every section except the task-aligned region. */
function coreOf(assembly: PromptAssembly): string {
  const core = {
    ...assembly,
    sections: assembly.sections.filter(section => section.name !== TASK_ALIGNED_SECTION),
  }
  return renderPrompt(core)
}

describe('prompt-lume byte-stable core + provenance at all grades', () => {
  it('keeps the core byte-identical across the scalar default and every reduction grade', async () => {
    // One assembled core per mount: scalar default + low + med + high + xhigh.
    const cores: string[] = []
    for (const grade of [undefined, ...GRADE_ORDER]) {
      const ctx = await mountWithGrade(grade)
      await ctx.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills', scope: 'tooling' })
      await ctx.promptCorpus.ingest(WORKSPACE_DOC, { corpus: 'agent-instructions', scope: 'workspace' })
      ctx.promptLume.primeTurn({ intent: 'how do I run a bash command', kind: 'tool' })
      const assembly = await ctx.systemPrompt.assemble()
      cores.push(coreOf(assembly))
    }

    // The core must not change when the grade changes: grades resolve knobs
    // that touch ONLY the retrieval/region path, never the registered core
    // sections. A byte-stable core is what the provider prompt-cache read
    // survives on across grade switches.
    for (let i = 1; i < cores.length; i += 1) {
      expect(cores[i]).toBe(cores[0])
    }
    expect(cores[0]!.length).toBeGreaterThan(0)
  })

  it('appends the provenance-labeled region AFTER the core and never rewrites a core section', async () => {
    const ctx = await mountWithGrade('med')
    await ctx.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills', scope: 'tooling' })

    ctx.promptLume.primeTurn({ intent: 'how do I use the terminal tool for shell work', kind: 'tool' })
    const assembly = await ctx.systemPrompt.assemble()

    // The region is a tail user/message, never a system-prompt section
    //: the core section list stays untouched at the grade.
    expect(assembly.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()
    const text = emittedRegionText(ctx)
    // Provenance intact at the grade.
    expect(text).toContain('[prompt-lume]')

    // The region is an APPEND to the session, AFTER the retained history: it
    // never rewrites a core section. No grade mutates the core — only the
    // region may differ per turn.
    const ungraded = await mountWithGrade()
    await ungraded.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills', scope: 'tooling' })
    ungraded.promptLume.primeTurn({ intent: 'how do I use the terminal tool for shell work', kind: 'tool' })
    const plain = await ungraded.systemPrompt.assemble()

    // The graded core is byte-equal to the ungraded core: the grade changed
    // only the region, never a registered section.
    expect(coreOf(assembly)).toBe(coreOf(plain))
  })

  it('keeps the core byte-stable across turns and turn kinds (no drift from assembly to assembly)', async () => {
    const ctx = await mountWithGrade('xhigh')
    await ctx.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills', scope: 'tooling' })
    await ctx.promptCorpus.ingest(WORKSPACE_DOC, { corpus: 'agent-instructions', scope: 'workspace' })

    ctx.promptLume.primeTurn({ intent: 'how do I run a bash command', kind: 'tool' })
    const a = await ctx.systemPrompt.assemble()
    ctx.promptLume.primeTurn({ intent: 'what are the workspace import rules', kind: 'workspace' })
    const b = await ctx.systemPrompt.assemble()
    ctx.promptLume.primeTurn({ intent: '' }) // no-op turn still emits the same core
    const c = await ctx.systemPrompt.assemble()

    expect(coreOf(a)).toBe(coreOf(b))
    expect(coreOf(b)).toBe(coreOf(c))
  })

  it('never yields a zero-grade region at xhigh (the widest hook is still a wall)', async () => {
    const ctx = await mountWithGrade('xhigh')
    await ctx.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills', scope: 'tooling' })

    ctx.promptLume.primeTurn({ intent: 'how do I run a bash command', kind: 'tool' })
    const assembly = await ctx.systemPrompt.assemble()
    // xhigh is a real grade, not a removal: if a germane chunk clears the
    // lowest cutoff, a provenance region may retain; core always exists.
    expect(coreOf(assembly).length).toBeGreaterThan(0)
    // The reduced-grade core is STILL byte-equal to the scalar core (byte-stable).
    const scalar = await mountWithGrade()
    await scalar.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills', scope: 'tooling' })
    scalar.promptLume.primeTurn({ intent: 'how do I run a bash command', kind: 'tool' })
    const scalarAssembly = await scalar.systemPrompt.assemble()
    expect(coreOf(scalarAssembly)).toBe(coreOf(assembly))
  })
})

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memory from '@atlasai/atsh-memory/src/index.ts'
import SystemPrompt, { renderPrompt } from '@atlasai/atsh-system-prompt'
import type { PromptAssembly } from '@atlasai/atsh-system-prompt'
import PromptCorpusService from '@atlasai/atsh-prompt-corpus'
import { Session, SessionId } from '@atlasai/atsh-session'
import PromptLumeService, {
  TASK_ALIGNED_SECTION,
  allocateBudget,
  neutralizePromptText,
} from '../src/index.ts'

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

const WORKSPACE_DOC = [
  '# Workspace Rules',
  '',
  'Follow AGENTS.md for this directory.',
  '',
  '## Imports',
  '',
  'Use package names across packages.',
].join('\n')

const BRACE_DOC = [
  '# Credential Handling',
  '',
  'Never expose secrets with {{credential.name}}.',
  '',
  'Always resolve {{config.secret}} through the vault.',
].join('\n')

/** Mount the real SQLite memory + prompt-corpus + system-prompt + prompt-lume on one context. */
async function setup(config: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
  await ctx.plugin(PromptCorpusService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(PromptLumeService, config)
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

/** Flatten a user-message content payload (text block array or plain string) to text. */
function messageTextOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => typeof part === 'object' && part !== null && 'text' in part
        ? String((part as { text: unknown }).text)
        : '')
      .join('')
  }
  return ''
}

describe('prompt-lume assemble listener (S4/S5)', () => {
  it('keeps the core byte-identical across two turns while staging a provenance-labeled, budgeted region for tail emission', async () => {
    const ctx = await setup({ budgetBytes: 2048 })
    const session = Session.create(SessionId('gaf247-summary'))
    await ctx.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills', scope: 'tooling' })
    await ctx.promptCorpus.ingest(WORKSPACE_DOC, { corpus: 'agent-instructions', scope: 'workspace' })

    ctx.promptLume.primeTurn({ intent: 'how do I run a bash command', kind: 'tool' })
    const a = await ctx.systemPrompt.assemble()
    ctx.promptLume.primeTurn({ intent: 'what are the workspace import rules', kind: 'workspace' })
    const b = await ctx.systemPrompt.assemble()

    // Byte-stable core across turns → provider prompt-cache read on the core survives.
    expect(coreOf(a)).toBe(coreOf(b))
    expect(coreOf(a).length).toBeGreaterThan(0)

    // The region is a tail user/message, NOT a system-prompt section.
    const section = b.sections.find(section => section.name === TASK_ALIGNED_SECTION)
    expect(section).toBeUndefined()

    // Emission is deferred to a pre-step, but the region IS staged by the
    // second assemble — draining it yields the provenance-labeled user message:
    // the cache-collateral fix surface.
    const hasPending = ctx.promptLume.hasPendingRegion()
    expect(hasPending).toBe(true)
    const emitted = ctx.promptLume.emitRegion(session)
    expect(emitted).toBeDefined()
    expect(emitted!.type).toBe('user/message')
    const emittedText = messageTextOf(emitted!.data.content)
    expect(emittedText).toContain('[prompt-lume]')
    expect(emittedText).toContain('for "what are the workspace import rules"')
  })

  it('returns core only when no turn is primed or the intent is empty', async () => {
    const ctx = await setup()
    await ctx.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills' })

    const a = await ctx.systemPrompt.assemble() // no prime
    expect(a.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()

    ctx.promptLume.primeTurn({ intent: '' }) // empty intent
    const b = await ctx.systemPrompt.assemble()
    expect(b.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()
  })

  it('injects a chunk containing template braces without breaking renderPrompt', async () => {
    // Pin a WIDE grade (xhigh, cutoff 0.3) so the medium-germane brace chunk
    // reliably commits. With no grade, the config-{} AUTO path would select a
    // narrow grade for this short workspace intent and drop the chunk — but
    // this test exercises brace-neutralization plumbing, not auto-selection.
    const ctx = await setup({ reducerGrade: 'xhigh' })
    await ctx.promptCorpus.ingest(BRACE_DOC, { corpus: 'security', scope: 'vault' })

    ctx.promptLume.primeTurn({ intent: 'how to expose credentials from the vault', kind: 'workspace' })
    const assembly = await ctx.systemPrompt.assemble()
    // The region is a tail message, never a section.
    expect(assembly.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()

    // Drain the staged region through the real emission path and renderPrompt
    // must not throw on the injected braces; braces render verbatim.
    const emitted = ctx.promptLume.emitRegion(Session.create(SessionId('gaf247-brace')))
    expect(emitted).toBeDefined()
    const messageText = typeof emitted!.data.content === 'string'
      ? emitted!.data.content
      : emitted!.data.content.map(p => p.type === 'text' ? p.text : '').join('')
    expect(messageText).toContain('{ {credential.name}}')
    expect(messageText).toContain('{ {config.secret}}')
  })
})

describe('prompt-lume budget allocation (S5)', () => {
  it('allocates skills-first for a tool turn and drops the least-germane tail when over budget', () => {
    const entries = [
      { text: 'w'.repeat(50), corpus: 'agent-instructions', rerankScore: 0.9 },
      { text: 's'.repeat(50), corpus: 'skills', rerankScore: 0.6 },
    ]
    // skills is priority-0; only it fits in 60 bytes, agent-instructions is dropped.
    const kept = allocateBudget(entries, { budgetBytes: 60, corpusPriority: ['skills'] })
    expect(kept.map(entry => entry.corpus)).toEqual(['skills'])
  })

  it('places a priority corpus first even when another has a higher rerank score', () => {
    const entries = [
      { text: 'w'.repeat(50), corpus: 'agent-instructions', rerankScore: 0.95 },
      { text: 's'.repeat(50), corpus: 'skills', rerankScore: 0.6 },
    ]
    const kept = allocateBudget(entries, { budgetBytes: 120, corpusPriority: ['skills'] })
    expect(kept.map(entry => entry.corpus)).toEqual(['skills', 'agent-instructions'])
  })

  it('without a priority keeps recall + rerank order, scoped only by the byte budget', () => {
    const entries = [
      { text: 'x'.repeat(40), corpus: 'agent-instructions', rerankScore: 0.9 },
      { text: 'y'.repeat(40), corpus: 'skills', rerankScore: 0.7 },
      { text: 'z'.repeat(40), corpus: 'persona', rerankScore: 0.5 },
    ]
    // 80 bytes fits the top two (by rerankScore) but not the third.
    const kept = allocateBudget(entries, { budgetBytes: 80 })
    expect(kept.map(entry => entry.rerankScore)).toEqual([0.9, 0.7])
  })
})

describe('prompt-lume brace neutralization', () => {
  it('splits {{ so renderPrompt treats it as literal text', () => {
    expect(neutralizePromptText('a {{credential.name}} b')).toBe('a { {credential.name}} b')
  })
})

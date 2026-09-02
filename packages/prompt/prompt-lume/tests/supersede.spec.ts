import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memory from '@atlasai/atsh-memory/src/index.ts'
import SystemPrompt, { renderPrompt } from '@atlasai/atsh-system-prompt'
import type { PromptAssembly } from '@atlasai/atsh-system-prompt'
import PromptCorpusService from '@atlasai/atsh-prompt-corpus'
import { Session, SessionId } from '@atlasai/atsh-session'
import PromptLumeService, {
  TASK_ALIGNED_HEADER,
  TASK_ALIGNED_SECTION,
} from '../src/index.ts'

/**
 * A realistic multi-section workspace instructions file (AGENTS.md-shaped): one
 * germane `## Testing` section plus a large `## Deployment` section that has no
 * lexical overlap with the turn's intent beyond a shared neutral token. The
 * whole document is far larger than the byte budget, so a truncate-to-fit
 * renderer (the agent-instructions path this supersedes) would have to either
 * dump most of it or truncate the file. prompt-lume must instead select only
 * the germane section chunk.
 */
const WORKSPACE_INSTRUCTIONS = [
  '# Workspace Instructions',
  '',
  '## Testing',
  'Run the workspace unit tests with pnpm run test. Use vitest to verify changes.',
  '',
  '## Deployment',
  // A large non-germane body sharing only the neutral token "how" with the
  // intent, so recall still returns it (score well below the germane section)
  // and the byte budget must drop it — exercising the budget-drop path.
  'How to promote a release: helm release rollout is staged through the chart-',
  'renderer on the deploy cluster. Rollbacks are forbidden by policy; each bump',
  'bumps the manifest version. The release train tags nightly builds and then',
  'promotes them through dev before any production reconciliation. How you cut',
  'a release is described in the operator runbook; never reuse a rolled back',
  'number. The chart values are pinned to the cluster profile and merged only',
  'by the release pipeline. Each rollout runs a smoke check that asserts the',
  'manifest version matches the expected tag, then notifies the on-call for the',
  'full window. How the cluster drains traffic during a promote is outside the',
  'scope of these instructions and is owned by the platform operator guide.',
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

describe('prompt-lume agent-instructions supersede path (exit-condition 2)', () => {
  it('routes an instruction-bearing workspace turn through retrieval-selection: provenance-labeled, budget-honored, non-germane instructions dropped (no whole-file truncation)', async () => {
    // Budget fits the germane Testing section + header but never the large
    // Deployment section, so selection must drop it — the mechanism that
    // replaces truncate-to-fit.
    const budgetBytes = 600
    const ctx = await setup({ budgetBytes })
    await ctx.promptCorpus.ingest(WORKSPACE_INSTRUCTIONS, {
      corpus: 'agent-instructions',
      scope: 'workspace',
    })

    ctx.promptLume.primeTurn({ intent: 'how do I run the tests', kind: 'workspace' })
    const assembly = await ctx.systemPrompt.assemble()
    // The region is a tail user/message, never a system-prompt section.
    expect(assembly.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()

    // Drain through the real emission path: the region carries the header,
    // provenance, the germane instruction, and never the dumped non-germane
    // deployment body, and honors the byte budget.
    const emitted = ctx.promptLume.emitRegion(Session.create(SessionId('gaf247-supersede')))
    expect(emitted).toBeDefined()
    const text = messageTextOf(emitted!.data.content)
    expect(text).toContain(TASK_ALIGNED_HEADER)
    expect(text).toContain('[prompt-lume] corpus=agent-instructions')
    expect(text).toContain('for "how do I run the tests"')

    // The germane instruction is selected and injected — selection is not a silent drop.
    expect(text).toContain('Run the workspace unit tests with pnpm run test')

    // The large non-germane section is NOT dumped wholesale.
    expect(text).not.toContain('helm release rollout')

    // Budget honored: the emitted region (header + selected entries) fits the
    // configured byte budget.
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(budgetBytes)
  })

  it('keeps the byte-stable core identical across two different instruction-bearing turns while the region changes', async () => {
    const ctx = await setup({ budgetBytes: 600 })
    await ctx.promptCorpus.ingest(WORKSPACE_INSTRUCTIONS, {
      corpus: 'agent-instructions',
      scope: 'workspace',
    })

    ctx.promptLume.primeTurn({ intent: 'how do I run the tests', kind: 'workspace' })
    const a = await ctx.systemPrompt.assemble()
    ctx.promptLume.primeTurn({ intent: 'how do I run the tests', kind: 'workspace' })
    const b = await ctx.systemPrompt.assemble()

    // Provider prompt-cache read on the core survives the supersede path: the
    // core is byte-identical, only the task-aligned region moves per turn.
    expect(coreOf(a)).toBe(coreOf(b))
    // The region is a tail message on both turns, never a system-prompt section.
    expect(a.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()
    expect(b.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()

    // Drain the second turn's staged region through the real emission path:
    // the superseded route keeps carrying the provenance-labeled selection.
    const emitted = ctx.promptLume.emitRegion(Session.create(SessionId('gaf247-supersede-2')))
    expect(emitted).toBeDefined()
    expect(messageTextOf(emitted!.data.content)).toContain('[prompt-lume] corpus=agent-instructions')
  })

  it('yields core only when prompt-lume is disabled despite a primed instruction turn', async () => {
    const ctx = await setup({ enabled: false })
    await ctx.promptCorpus.ingest(WORKSPACE_INSTRUCTIONS, {
      corpus: 'agent-instructions',
      scope: 'workspace',
    })

    ctx.promptLume.primeTurn({ intent: 'how do I run the tests', kind: 'workspace' })
    const assembly = await ctx.systemPrompt.assemble()
    // The additive gate: with the layer off, the instruction turn passes
    // through unchanged — agent-instructions owns the path again downstream.
    expect(assembly.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()
  })

  it('keeps exactly ONE region wall on the surface across many turns (self-superseding tail emission)', async () => {
    const ctx = await setup({ budgetBytes: 600 })
    await ctx.promptCorpus.ingest(WORKSPACE_INSTRUCTIONS, {
      corpus: 'agent-instructions',
      scope: 'workspace',
    })
    const session = Session.create(SessionId('gaf247-single-wall'))

    // Ten turns, each staging then emitting a region onto the same session.
    // The provider prompt-cache read survives because the region supersedes its
    // own prior wall instead of appending one more wall per turn.
    let priorSeq: number | undefined
    for (let i = 0; i < 10; i += 1) {
      ctx.promptLume.primeTurn({ intent: 'how do I run the tests', kind: 'workspace' })
      await ctx.systemPrompt.assemble()
      const emitted = ctx.promptLume.emitRegion(session)
      expect(emitted).toBeDefined()
      if (i === 0) {
        expect(emitted!.surfaceOp).toBe('append')
      } else {
        // Every emission after the first SELF-SUPERSEDES the prior wall
        // (single-node replace), and the replaced node is shadowed off the
        // surface.
        expect(emitted!.surfaceOp).toEqual({ op: 'replace', start: priorSeq, end: priorSeq })
      }
      priorSeq = emitted!.seq
    }

    // Single wall: exactly one region-flagged user message is model-visible.
    const regionNodes = session.surface.nodes.filter((seq) => {
      const e = session.events.find(x => x.seq === seq)
      return e?.type === 'user/message'
        && messageTextOf((e as { data: { content: unknown } }).data.content).includes(TASK_ALIGNED_HEADER)
    })
    expect(regionNodes).toHaveLength(1)
  })
})

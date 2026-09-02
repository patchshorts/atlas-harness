import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memory from '@atlasai/atsh-memory/src/index.ts'
import { createUserMessage } from '@atlasai/atsh-llm'
import { Session, SessionId } from '@atlasai/atsh-session'
import SystemPrompt, { renderPrompt } from '@atlasai/atsh-system-prompt'
import type { PromptAssembly } from '@atlasai/atsh-system-prompt'
import PromptCorpusService from '@atlasai/atsh-prompt-corpus'
import PromptLumeService, { TASK_ALIGNED_HEADER, TASK_ALIGNED_SECTION } from '../src/index.ts'
import { GRADE_ORDER } from '../src/grade.ts'
import type { ReductionGrade } from '../src/grade.ts'
import type { TurnSurface } from '../src/index.ts'
import type { PromptLumeCostRecord } from '../src/cost.ts'
import { CostSidecar } from '../src/cost.ts'

const SKILLS_DOC = [
  '# Bash Skills',
  '',
  'You can run bash commands in a sandboxed shell.',
  '',
  '## Tools',
  '',
  'Use the terminal tool for shell work.',
  '',
  'Never expose secrets with {{credential.name}}.',
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

const PERSONA_DOC = [
  '# Agent Identity',
  '',
  'You are a focused engineering assistant.',
  '',
  '## Style',
  '',
  'Answer directly; prefer plain words.',
].join('\n')

/** Mount the real SQLite memory + prompt-corpus + system-prompt + prompt-lume with a grade. */
async function mountWithGrade(grade?: ReductionGrade): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
  await ctx.plugin(PromptCorpusService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(PromptLumeService, grade ? { reducerGrade: grade } : {})
  return ctx
}

/** Render the byte-stable core: every section except the task-aligned region. */
function coreOfAssembly(assembly: PromptAssembly): string {
  const core = {
    ...assembly,
    sections: assembly.sections.filter(section => section.name !== TASK_ALIGNED_SECTION),
  }
  return renderPrompt(core)
}

/** Flatten a message-content payload (text block array or plain string) to text. */
function messageContentText(content: unknown): string {
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

/** Flatten one surface node's message text ('' when the event carries none). */
function surfaceNodeText(session: Session, seq: number): string {
  const event = session.events.find(entry => entry.seq === seq)
  if (event === undefined) return ''
  const content = (event as { data?: { content?: unknown } }).data?.content
  return content === undefined ? '' : messageContentText(content)
}

/**
 * Split a session's model-visible byte stream at the task-aligned region wall.
 *
 * The stream a provider prompt-cache reads is the byte-stable system-prompt
 * render (the core) followed by the retained conversation surface in
 * model-visible order. the prior workstream made the region a self-superseding TAIL
 * user/message, so everything strictly BEFORE the region header — the core
 * plus retained history — is what the cache re-reads byte-for-byte across
 * turns; only the region node bytes move. Returns that prefix alongside the
 * region's own text so a test can assert the two independently.
 */
function segmentRegion(core: string, session: Session): { prefix: string; region: string } {
  let region = ''
  const history: string[] = []
  for (const seq of session.surface.nodes) {
    const text = surfaceNodeText(session, seq)
    if (text.includes(TASK_ALIGNED_HEADER)) region = text
    else history.push(text)
  }
  return { prefix: [core, ...history].filter(text => text.length > 0).join('\n\n'), region }
}

/** Count the region walls (user messages carrying the task-aligned header) on a surface. */
function regionWallCount(session: Session): number {
  let count = 0
  for (const seq of session.surface.nodes) {
    if (surfaceNodeText(session, seq).includes(TASK_ALIGNED_HEADER)) count += 1
  }
  return count
}

/**
 * Provider cache-read survival: the byte-stable core is what the
 * provider prompt-cache reads across turns. The live cost records prove the
 * gate holds no matter which turn tag the loop is on.
 */
describe('prompt-lume provider cache-read survival', () => {
  it('keeps the emitted core byte-identical across turn kinds, so cacheHit stays true from the second call on at every grade', async () => {
    for (const grade of GRADE_ORDER) {
      const ctx = await mountWithGrade(grade)
      await ctx.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills', scope: 'tooling' })
      await ctx.promptCorpus.ingest(WORKSPACE_DOC, { corpus: 'agent-instructions', scope: 'workspace' })
      await ctx.promptCorpus.ingest(PERSONA_DOC, { corpus: 'persona', scope: 'identity' })

      const records: PromptLumeCostRecord[] = []
      ctx.on('prompt-lume/cost', (record) => { records.push(record) })

      const turns: TurnSurface[] = [
        { intent: 'how do I run a bash command', kind: 'tool' },
        { intent: 'what are the workspace import rules', kind: 'workspace' },
        { intent: 'who am I and how should I respond', kind: 'identity' },
        { intent: 'summarize the sandbox rules', kind: 'general' },
      ]

      const cores: string[] = []
      for (const turn of turns) {
        ctx.promptLume.primeTurn(turn)
        cores.push(coreOfAssembly(await ctx.systemPrompt.assemble()))
      }

      // Byte-stable core across every turn tag: the provider prefix never
      // drifts no matter which kind the turn carries.
      for (let i = 1; i < cores.length; i += 1) {
        expect(cores[i]).toBe(cores[0])
      }
      expect(cores[0]!.length).toBeGreaterThan(0)

      // The provider cache-read signal from the cost sidecar: call 1 is the
      // cold miss (nothing prior to match), every later call is a hit because
      // the sidecar held the byte-identical previous core.
      expect(records).toHaveLength(turns.length)
      if (records.length > 0) expect(records[0]!.cacheHit).toBe(false)
      for (let i = 1; i < records.length; i += 1) {
        expect(records[i]!.cacheHit).toBe(true)
      }

      // coreTokens (heuristic, 4 chars/token) is identical across the run:
      // the region may differ, the core never.
      const firstTokens = records[0]!.coreTokens
      for (const record of records) {
        expect(record.coreTokens).toBe(firstTokens)
      }

      const summary = ctx.promptLume.costSummary()
      expect(summary.calls).toBe(turns.length)
      expect(summary.cacheHits).toBe(turns.length - 1)
      expect(summary.cacheMisses).toBe(1)
    }
  })

  it('emits core-only (regionBytes 0, regionTokens 0) with a still-cached core across repeated core-only turns', async () => {
    // No corpus at all: recall returns nothing, so every turn is core-only.
    const ctx = await mountWithGrade('xhigh')
    const records: PromptLumeCostRecord[] = []
    ctx.on('prompt-lume/cost', (record) => { records.push(record) })

    const cores: string[] = []
    for (const intent of ['one', 'two', 'three']) {
      ctx.promptLume.primeTurn({ intent, kind: 'general' })
      cores.push(coreOfAssembly(await ctx.systemPrompt.assemble()))
    }

    expect(records).toHaveLength(3)
    expect(records[0]!.cacheHit).toBe(false)
    expect(records[1]!.cacheHit).toBe(true)
    expect(records[2]!.cacheHit).toBe(true)
    expect(records[1]!.regionTokens).toBe(0)
    expect(records[1]!.regionBytes).toBe(0)
    // Core identical even across different empty-region calls.
    expect(cores[1]).toBe(cores[0])
    expect(cores[2]).toBe(cores[0])
  })

  it('marks a real core mutation as a cache MISS — the gate is a real byte-identity check, not a ghost success', () => {
    // Deterministic sidecar test: same core = hit, changed core = miss. This
    // proves cacheHit is an exact byte-identity relation to the prior core, so
    // the provider cache-read guarantee only holds while the core actually is
    // byte-stable (never a false positive after a genuine change).
    const sidecar = new CostSidecar()
    const first = sidecar.record('core-identity-v1', 'region a', 4096)
    expect(first.cacheHit).toBe(false)

    const hit = sidecar.record('core-identity-v1', 'region b', 4096)
    expect(hit.cacheHit).toBe(true)

    // A real core mutation flips the gate to a miss.
    const mutated = sidecar.record('core-identity-v2', 'region c', 4096)
    expect(mutated.cacheHit).toBe(false)

    const back = sidecar.record('core-identity-v2', 'region d', 4096)
    expect(back.cacheHit).toBe(true)

    const summary = sidecar.summary()
    expect(summary.calls).toBe(4)
    expect(summary.cacheHits).toBe(2)
    expect(summary.cacheMisses).toBe(2)
  })
})

/**
 * T3 keyless prefix-identity (GO2 provider-cache mechanism).
 *
 * the prior workstream moved the task-aligned region OUT of the system prompt
 * (assembly.sections) into a self-superseding tail user/message. These proofs
 * run with real SQLite memory + retrieval — no API key, no subprocess — and
 * assert the mechanism at the MESSAGE level: the byte stream the provider
 * prompt-cache reads is [byte-stable core] + [retained history] + [one region
 * tail]. The positive proof shows only the region bytes move while everything
 * before the region node is byte-identical across turns; the negative
 * discriminator shows the legacy region-as-system-section shape would fail
 * this gate (its changing region sits inside the cached prefix).
 */
describe('T3 keyless prefix-identity (GO2 provider-cache mechanism)', () => {
  it('keeps the full byte-identical prefix (core + retained history) while only the tail region changes across turns — message-level proof', async () => {
    const ctx = await mountWithGrade('xhigh')
    await ctx.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills', scope: 'tooling' })
    await ctx.promptCorpus.ingest(WORKSPACE_DOC, { corpus: 'agent-instructions', scope: 'workspace' })
    await ctx.promptCorpus.ingest(PERSONA_DOC, { corpus: 'persona', scope: 'identity' })

    const session = Session.create(SessionId('gaf247-message-level'))
    // A real retained conversation message living ahead of the region wall on
    // the same surface: it is part of the cache prefix the model re-reads.
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Let me orient on the workspace first.' }],
      source: { kind: 'plugin', plugin: 'test/retained-history' },
    }), { surfaceOp: 'append' })

    const turns: TurnSurface[] = [
      { intent: 'how do I run a bash command', kind: 'tool' },
      { intent: 'what are the workspace import rules', kind: 'workspace' },
      { intent: 'imports and package names', kind: 'workspace' },
    ]

    const cores: string[] = []
    const prefixes: string[] = []
    const regions: string[] = []
    for (const turn of turns) {
      ctx.promptLume.primeTurn(turn)
      const assembly = await ctx.systemPrompt.assemble()
      // The region is a tail user/message, never a system-prompt section.
      expect(assembly.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()
      // Byte-stable core = the full assembly render (the region is not a section).
      const core = renderPrompt(assembly)
      cores.push(core)
      const emitted = ctx.promptLume.emitRegion(session)
      expect(emitted).toBeDefined()
      const { prefix, region } = segmentRegion(core, session)
      prefixes.push(prefix)
      regions.push(region)
      // Exactly one region wall is ever on the surface (self-superseding tail).
      expect(regionWallCount(session)).toBe(1)
    }

    // The core render is byte-identical at the message level too.
    for (let i = 1; i < cores.length; i += 1) {
      expect(cores[i]).toBe(cores[0])
    }
    // The whole model-visible prefix ahead of the region — core render plus the
    // retained history message — is byte-identical on every turn: the provider
    // prompt-cache keeps re-reading the same prefix across the region drift.
    for (let i = 1; i < prefixes.length; i += 1) {
      expect(prefixes[i]).toBe(prefixes[0])
    }
    // The retained history genuinely rides inside the identical prefix.
    expect(prefixes[0]).toContain('Let me orient on the workspace first.')
    // Only the tail region bytes move: each turn's region differs from the
    // first, so the byte drift is confined to the region node alone.
    expect(regions[1]).not.toBe(regions[0])
    expect(regions[2]).not.toBe(regions[0])
    // Every turn still emits a real, non-trivial region (the proof is not a ghost).
    for (const region of regions) {
      expect(region.length).toBeGreaterThan(0)
      expect(region).toContain(TASK_ALIGNED_HEADER)
    }
  })

  it('rejects the legacy region-as-system-section shape (discriminator)', async () => {
    const ctx = await mountWithGrade('xhigh')
    await ctx.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills', scope: 'tooling' })
    await ctx.promptCorpus.ingest(WORKSPACE_DOC, { corpus: 'agent-instructions', scope: 'workspace' })

    const session = Session.create(SessionId('gaf247-legacy-shape'))
    const turns: TurnSurface[] = [
      { intent: 'how do I run a bash command', kind: 'tool' },
      { intent: 'what are the workspace import rules', kind: 'workspace' },
    ]

    const cores: string[] = []
    const legacyRenders: string[] = []
    for (const turn of turns) {
      ctx.promptLume.primeTurn(turn)
      const assembly = await ctx.systemPrompt.assemble()
      // The new build keeps the region OUT of the section list.
      expect(assembly.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()
      cores.push(renderPrompt(assembly))
      // Drain the real emission to capture the region text, then forge the
      // legacy 313f809 buggy shape: push the region back as a system-prompt
      // section so it lands INSIDE the cached prefix a later turn must re-read.
      const emitted = ctx.promptLume.emitRegion(session)
      const regionText = emitted === undefined ? '' : messageContentText(emitted.data.content)
      const legacyShape = {
        ...assembly,
        sections: [...assembly.sections, { name: TASK_ALIGNED_SECTION, text: regionText }],
      }
      legacyRenders.push(renderPrompt(legacyShape))
    }

    // The core itself is byte-stable across the two turns: only the forged
    // section placement is what differs between the renders.
    expect(cores[0]).toBe(cores[1])
    // The legacy full render DIFFERS: the changing region is embedded in the
    // cached-prefix system prompt, so today's pre-fix build would fail this
    // gate (the provider cache could not read a byte-identical prefix). The
    // tail-emission shape is what keeps the identity proof green.
    expect(legacyRenders[0]).not.toBe(legacyRenders[1])
  })
})

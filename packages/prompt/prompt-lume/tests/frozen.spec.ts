import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memory from '@atlasai/atsh-memory/src/index.ts'
import SystemPrompt, { renderPrompt } from '@atlasai/atsh-system-prompt'
import type { PromptAssembly } from '@atlasai/atsh-system-prompt'
import PromptCorpusService from '@atlasai/atsh-prompt-corpus'
import PromptContextTrimService from '@atlasai/atsh-prompt-context-trim'
import PromptLumeService, { TASK_ALIGNED_SECTION } from '@atlasai/atsh-prompt-lume'
import { Session } from '@atlasai/atsh-session'
import { GRADE_ORDER } from '../src/grade.ts'
import type { ReductionGrade } from '../src/grade.ts'
import type { PromptLumeCostRecord } from '../src/cost.ts'
import * as prime from '../src/prime.ts'
import { messageTextOf, stableRegionSession } from './emit-helper.ts'

/**
 * the corrections pass — frozen-projection suite (the golden-rule gate).
 *
 * The locked thesis of the whole saga: the reducer is a complexity-matched
 * hook-width ladder (narrow hook = least context for simple tasks; wide hook =
 * most context for complex problems) that NEVER drops the VALUABLE content — a
 * "frozen projection" of the corpus into the task-aligned region. This spec
 * proves that invariant through the REAL boot composition
 * (memory + prompt-corpus + system-prompt + prompt-lume + prompt-context-trim +
 * prompt-lume-prime) across the four grades:
 *
 *   1. FROZEN DETERMINISM — the same corpus + intent assembled twice on one
 *      mount, and once on a separately-constructed fresh mount, yields a
 *      byte-identical task-aligned region. The projection is a pure function —
 *      no run-to-run drift, no session artifact. A snowed model-visible
 *      history never drifts between turns or sessions (golden rule).
 *   2. NOTHING-VALUABLE-DROPPED MONOTONE GATE — chunk retention is driven ONLY
 *      by the grade's ranking cutoff against the chunk's real measured recall
 *      score. Four score-distinct chunks (real scores 1.0 / ~0.71 / ~0.57 /
 *      ~0.43 measured against the shared intent) fold exactly as the hook
 *      WIDENS: the fully-germane chunk (1.0) is injected at EVERY grade (clears
 *      even the narrow low 0.85); a high-germane chunk (~0.71) clears where the
 *      cutoff is at or below 0.7 (med, high, xhigh — NOT low); a mid chunk
 *      (~0.57) clears from high (0.5); a low chunk (~0.43) clears only at xhigh
 *      (0.3). NO grade drops the valuable full-germane core — the narrow hook
 *      keeps only the most-germane, the wide hook retains the full tail.
 *   3. WALL INVARIANT — every grade still bends to a finite wall: each mounting
 *      emits a nonzero task-aligned region (no zero-grade path), the region
 *      respects the resolved hook row's byte budget, retained chunks carry
 *      provenance, and the byte-stable CORE is invariant across all four grades
 *      (the provider cache-read constant).
 *
 * The four corpus chunks below have MEASURED real recall scores against the
 * shared intent (probed live against the real SQLite store — the score is the
 * query-token match ratio): A 1.0, B ~0.71, C ~0.57, D ~0.43. Each body carries
 * a UNIQUE marker so retention is asserted by marker, never by prose.
 */

/** Seed a minimal instruction root so the real prime.apply() reads a file. */
async function seedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gaf210-frozen-'))
  await writeFile(join(root, 'AGENTS.md'), '# Atlas Harness\nResolve imports through the workspace store.\n')
  return root
}

/** The retrieval intent whose lexical overlap with the four chunks is fixed. */
const INTENT = 'how do i run the unit tests'

/** Fully-germane chunk — real recall score 1.0. Retained at every grade. */
const DOC_A = [
  'how do i run the unit tests',
  '',
  'A7_UNIQUE_MARKER vitest terminal verify changes and suite green',
].join('\n')

/** High-germane chunk — real recall score 0.714 (5/7). */
const DOC_B = [
  'how do i run the',
  '',
  'B5_UNIQUE_MARKER terminal verify pass pipeline rollout checks',
].join('\n')

/** Mid-germane chunk — real recall score 0.571 (4/7). */
const DOC_C = [
  'how do i run',
  '',
  'C4_UNIQUE_MARKER workspace verify pass pipeline gate hygiene',
].join('\n')

/** Low-germane chunk — real recall score 0.429 (3/7). */
const DOC_D = [
  'how do i',
  '',
  'D3_UNIQUE_MARKER workspace pass pipeline chart release',
].join('\n')

const ALL_DOCS = [DOC_A, DOC_B, DOC_C, DOC_D]

/** Render the byte-stable core (every section except the task-aligned region). */
function coreOf(assembly: PromptAssembly): string {
  const core = {
    ...assembly,
    sections: assembly.sections.filter(section => section.name !== TASK_ALIGNED_SECTION),
  }
  return renderPrompt(core)
}

/**
 * Mount the REAL reducer suite with a grade and ingest the four score-distinct
 * chunks under one instruction corpus.
 */
async function compose(grade: ReductionGrade): Promise<{ ctx: Context; root: string }> {
  const root = await seedRoot()
  const ctx = new Context()
  await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
  await ctx.plugin(PromptCorpusService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(PromptLumeService, { reducerGrade: grade })
  await ctx.plugin(PromptContextTrimService)
  await ctx.plugin(prime, { enabled: true, root, maxFileBytes: 1024 * 1024 })
  for (const doc of ALL_DOCS) {
    await ctx.promptCorpus.ingest(doc, { corpus: 'agent-instructions', scope: 'workspace' })
  }
  return { ctx, root }
}

/** Run one primed assembly; returns the region text + the byte-stable core. */
async function assembleOn(ctx: Context): Promise<{ regionText: string | undefined; coreText: string }> {
  ctx.promptLume.primeTurn({ intent: INTENT, kind: 'workspace' })
  const assembly = await ctx.systemPrompt.assemble()
  const lume = ctx.promptLume as unknown as { emitRegion(s: Session): { data: { content: unknown } } | undefined }
  const emitted = lume.emitRegion(stableRegionSession(ctx))
  const regionText = emitted === undefined ? undefined : messageTextOf(emitted.data.content)
  return { regionText, coreText: coreOf(assembly) }
}

describe('prompt-lume frozen projection — nothing valuable dropped', () => {
  it('emits a byte-identical region across two turns AND a fresh independently-constructed mount (frozen determinism)', async () => {
    const first = await compose('high')
    try {
      const r1 = await assembleOn(first.ctx)
      const r2 = await assembleOn(first.ctx)
      expect(r1.regionText).toBe(r2.regionText)
      expect(r1.coreText).toBe(r2.coreText)

      // A FRESH mount (independently-constructed) must reproduce the identical
      // region — the projection is a pure function of corpus+grade+intent, not
      // a session artifact. Determinism = no run-to-run drift = the golden rule
      // (a snowed model-visible history never drifts between turns or sessions).
      const fresh = await compose('high')
      try {
        const rf = await assembleOn(fresh.ctx)
        expect(rf.regionText).toBe(r1.regionText)
        expect(rf.coreText).toBe(r1.coreText)
      } finally {
        await rm(fresh.root, { recursive: true, force: true })
      }
    } finally {
      await rm(first.root, { recursive: true, force: true })
    }
  })

  it('never drops the fully-valuable chunk at any grade (the A7 core clears even the narrowest low 0.85 cutoff)', async () => {
    for (const grade of GRADE_ORDER) {
      const { ctx, root } = await compose(grade)
      try {
        const { regionText } = await assembleOn(ctx)
        expect(regionText, `grade ${grade} must emit a region`).toBeDefined()
        // A7 is the fully-germane value (1.0): what the reduction keeps for the
        // user's intent must NEVER vanish at any hook width (frozen, not
        // funneled away) — even the narrow low 0.85 cutoff clears it.
        expect(regionText!, `grade ${grade} must retain the A7 (full-germane) chunk`).toContain(
          'A7_UNIQUE_MARKER',
        )
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })

  it('retains more of the tail as the hook WIDENS (monotone value-gating, the narrow hook keeps only the most-germane)', async () => {
    // Expected retention per GRADE by REAL measured score vs the REAL cutoffs
    // (0.85 / 0.7 / 0.5 / 0.3 for low / med / high / xhigh) — verified live:
    //   A7  score 1.0     → in at every grade (clears even the narrow 0.85)
    //   B5  score ~0.71  → in at med, high, xhigh; OUT at low (0.85)
    //   C4  score ~0.57  → in at high, xhigh;      OUT at med  (0.7)
    //   D3  score ~0.43  → in at xhigh only;       OUT at high (0.5)
    const cases: Array<{ grade: ReductionGrade; b: boolean; c: boolean; d: boolean }> = [
      { grade: 'low', b: false, c: false, d: false },
      { grade: 'med', b: true, c: false, d: false },
      { grade: 'high', b: true, c: true, d: false },
      { grade: 'xhigh', b: true, c: true, d: true },
    ]
    for (const { grade, b, c, d } of cases) {
      const { ctx, root } = await compose(grade)
      try {
        const { regionText } = await assembleOn(ctx)
        expect(regionText, `grade ${grade} must always retain the full-germane A7 chunk`).toContain(
          'A7_UNIQUE_MARKER',
        )
        expect(
          regionText!.includes('B5_UNIQUE_MARKER'),
          `grade ${grade} B5 retention expected ${b}`).toBe(b)
        expect(
          regionText!.includes('C4_UNIQUE_MARKER'),
          `grade ${grade} C4 retention expected ${c}`).toBe(c)
        expect(
          regionText!.includes('D3_UNIQUE_MARKER'),
          `grade ${grade} D3 retention expected ${d}`).toBe(d)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })

  it('keeps every grade a finite wall (no zero-grade), budget-honored, provenance-labeled, and the byte-stable core invariant', async () => {
    const cores = new Set<string>()
    for (const grade of GRADE_ORDER) {
      const { ctx, root } = await compose(grade)
      try {
        const records: PromptLumeCostRecord[] = []
        ctx.on('prompt-lume/cost', (record) => { records.push(record) })
        const { regionText, coreText } = await assembleOn(ctx)
        expect(regionText).toBeDefined()
        cores.add(coreText)

        // Provenance labels the retained chunks.
        expect(regionText!).toContain('[prompt-lume]')
        expect(records).toHaveLength(1)

        // The resolved hook row recorded the finite budget; the region respects
        // the byte cap at every grade (a wall, never absent).
        const budget = records[0]!.budgetBytes
        expect(Buffer.byteLength(regionText!, 'utf8')).toBeLessThanOrEqual(budget)
        // No fabricated zero wall: a nonzero region fires — the wall exists.
        expect(records[0]!.regionBytes).toBeGreaterThan(0)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
    // The byte-stable CORE is invariant across all four grades (cache read survives).
    expect(cores.size).toBe(1)
  })
})

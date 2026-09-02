import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memory from '@atlasai/atsh-memory/src/index.ts'
import SystemPrompt from '@atlasai/atsh-system-prompt'
import PromptCorpusService from '@atlasai/atsh-prompt-corpus'
import PromptContextTrimService from '@atlasai/atsh-prompt-context-trim'
import PromptLumeService from '@atlasai/atsh-prompt-lume'
import { GRADE_ORDER } from '../src/grade.ts'
import type { PromptLumeCostRecord } from '../src/cost.ts'
import * as prime from '../src/prime.ts'
import { emittedRegionText } from './emit-helper.ts'

/**
 * the corrections pass — graded progression measurement (low/med/high/xhigh).
 *
 * The complexity-matched hook ladder: hook width grows with grade. The low
 * grade keeps the NARROWEST hook — the LEAST context for the simplest tasks
 * (LOWEST token-in); the xhigh grade keeps the WIDEST hook — the MOST context
 * for the most complex problems (HIGHEST token-in). Every grade still sits
 * behind a finite wall — there is no zero grade.
 *
 * This spec composes the REAL boot suite at EVERY grade, seeds a corpus of
 * greeting-germane chunks (each scoring 1.0 against the greeting intent so the
 * per-grade ranking cutoff does not selectively drop chunks), primes the same
 * trivial-greeting intent, and reads the ACTUAL token-in from the real
 * `prompt-lume/cost` event each assembly emits. The hook-width math is real:
 * the top-k chunk commit cap (1/3/6/12) and the footprint of each rendered
 * entry drive the retained content, and the byte budget (512/2048/4096/8192)
 * never under-fits the small greeting entries. Every number is the measured
 * value; no magnitude is fabricated or hardcoded. The measured progression is
 * surfaced verbatim in the TICK result.
 *
 * Hook rows (grade.ts): low 2/0.85/1/512, med 4/0.7/3/2048,
 * high 8/0.5/6/4096, xhigh 12/0.3/12/8192 (searchSpan/cutoff/commit/budget).
 */

/** Seed a minimal instruction root so hot prime.apply() reads a file. */
async function seedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gaf210-grade-'))
  await writeFile(join(root, 'AGENTS.md'), '# Atlas Harness\nResolve imports through the workspace store.\n')
  return root
}

/** The trivial-turn retrieval intent — matches the T10/T11 greeting contract. */
const GREETING_INTENT = 'hello how can I help you what can I do for you today'

/**
 * A corpus of greeting-germane chunks. Each chunk contains every retrieval token
 * (so the low ranking cutoff 0.85 still passes it) plus a distinct suffix (so
 * the memory store treats them as separate rows, not one deduped record).
 * N = GK count spans the WIDEST hook's commit ceiling (xhigh 12) so xhigh
 * retains strictly more than high, high more than med, med more than low.
 */
const CHUNK_COUNT = 12
const CHUNK_BODIES: string[] = Array.from({ length: CHUNK_COUNT }, (_, i) =>
  [
    '# Greeting chunk',
    '',
    'hello how can I help you what can I do for you today.',
    `channel ${i + 1}: assistant offers a friendly welcome and a short offer of help.`,
  ].join('\n'),
)
const GREETING_CORPUS = CHUNK_BODIES.join('\n\n')

/** Mount the real reducer suite at one grade (matches boot.spec.ts composition). */
async function compose(grade: (typeof GRADE_ORDER)[number]): Promise<{ ctx: Context; root: string }> {
  const root = await seedRoot()
  const ctx = new Context()
  await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
  await ctx.plugin(PromptCorpusService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(PromptLumeService, { reducerGrade: grade })
  await ctx.plugin(PromptContextTrimService)
  await ctx.plugin(prime, { enabled: true, root, maxFileBytes: 1024 * 1024 })
  return { ctx, root }
}

/** Run one trivial-turn assembly at a grade and return the real cost record. */
async function measure(grade: (typeof GRADE_ORDER)[number]): Promise<{
  record: PromptLumeCostRecord
  regionText: string
}> {
  const { ctx, root } = await compose(grade)
  try {
    await ctx.promptCorpus.ingest(GREETING_CORPUS, { corpus: 'skills', scope: 'tooling' })

    const records: PromptLumeCostRecord[] = []
    ctx.on('prompt-lume/cost', (record) => { records.push(record) })

    ctx.promptLume.primeTurn({ intent: GREETING_INTENT, kind: 'tool' })
    await ctx.systemPrompt.assemble()

    // The region is a tail user/message, never a system-prompt section — read
    // it through the real emission path (self-superseding, stable per-ctx session).
    const regionText = emittedRegionText(ctx)
    expect(regionText, 'grade must emit a region').not.toBe('')
    expect(records).toHaveLength(1)
    return { record: records[0]!, regionText }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('prompt-lume graded progression measurement', () => {
  it('measures monotonic token-in low < med < high < xhigh from the real cost events', async () => {
    // Measured one per grade — the numbers ARE the record's input length.
    const measured = new Map<(typeof GRADE_ORDER)[number], { record: PromptLumeCostRecord; regionText: string }>()
    for (const grade of GRADE_ORDER) {
      measured.set(grade, await measure(grade))
    }

    const tokens = (grade: (typeof GRADE_ORDER)[number]) => measured.get(grade)!.record.inputTokens
    const regions = (grade: (typeof GRADE_ORDER)[number]) => measured.get(grade)!.record.regionTokens

    for (const grade of GRADE_ORDER) {
      expect(measured.get(grade)!.record.inputTokens).toBe(
        measured.get(grade)!.record.coreTokens + measured.get(grade)!.record.regionTokens,
      )
    }

    // The lock: wider hook = more context retained = HIGHER token-in. The four
    // recorded input lengths must strictly ascend low < med < high < xhigh.
    expect(tokens('low')).toBeLessThan(tokens('med'))
    expect(tokens('med')).toBeLessThan(tokens('high'))
    expect(tokens('high')).toBeLessThan(tokens('xhigh'))

    // Same monotone direction on the region itself (the hook-committed content).
    expect(regions('low')).toBeLessThan(regions('med'))
    expect(regions('med')).toBeLessThan(regions('high'))
    expect(regions('high')).toBeLessThan(regions('xhigh'))

    // Every grade is still behind a wall — no zero-commit path.
    for (const grade of GRADE_ORDER) {
      expect(measured.get(grade)!.record.regionTokens).toBeGreaterThan(0)
      expect(measured.get(grade)!.record.regionBytes).toBeGreaterThan(0)
      expect(measured.get(grade)!.record.budgetBytes).toBeGreaterThan(0)
    }

    // The byte-stable core is invariant across grades (cache read survives);
    // grade knobs touch ONLY the retrieval/region path.
    const cores = new Set(GRADE_ORDER.map(grade => measured.get(grade)!.record.coreTokens))
    expect(cores.size).toBe(1)

    // Each retained chunk is provenance-labeled (attributable injection).
    for (const grade of GRADE_ORDER) {
      expect(measured.get(grade)!.regionText).toContain('[prompt-lume]')
    }

    // Surface the real measured progression for the TICK result — measured,
    // never fabricated or hardcoded above.
    console.log(
      `GRADE-PROGRESSION ${GRADE_ORDER.map(g =>
        `${g}=${tokens(g)}tok(r=${regions(g)})`).join(' ')} cores=${cores.size === 1 ? [...cores][0] : 'MIXED'}`,
    )
  })
})

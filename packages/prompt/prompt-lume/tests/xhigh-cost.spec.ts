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
import type { PromptLumeCostRecord } from '../src/cost.ts'
import * as prime from '../src/prime.ts'
import { emittedRegionText } from './emit-helper.ts'

/**
 * the corrections pass — low trivial-turn token-cost measurement.
 *
 * The trv-01-..trivial-turn bench task (T10) verifies the BEHAVIORAL contract
 * deterministically; the actual token-in number is measured HERE, separately
 * (that separation is written into the verifier's header). The locked thesis
 * under the INVERTED ladder: a trivial greeting under LOW (the now-narrowest
 * hook, = simplest tasks) must cost near-minimal token-in while still sitting
 * behind a finite wall (low is the NARROWEST hook, not a zero grade). The wide
 * xhigh hook serves complex problems — it is measured separately by the graded
 * progression spec.
 *
 * This spec composes the REAL boot suite — memory, prompt-corpus,
 * system-prompt, prompt-lume, prompt-context-trim, prompt-lume-prime — at
 * reducerGrade 'low' (the simplest grade the harness auto-selects for a
 * trivial intent), primes the trivial-greeting intent, and reads the ACTUAL
 * token-in from the real `prompt-lume/cost` event the assembly emits. Every
 * number below is the measured value from the real cost event — no fabricated
 * or hardcoded magnitude is asserted. The measured value is surfaced in the
 * TICK result (the spec records records[0].inputTokens / regionBytes verbatim).
 *
 * The low row (grade.ts): corpusSearchSpan 2, rankingCutoff 0.85,
 * chunkCommitCount 1, regionByteBudget 512 — the narrowest hook, still a wall.
 */

/** Seed a tiny instruction root so prime.apply() ingests a controlled set. */
async function seedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gaf210-xcost-'))
  await writeFile(join(root, 'AGENTS.md'), '# Atlas Harness\nResolve imports through the workspace store.\n')
  return root
}

/** A one-chunk doc whose recall score reaches 1.0 for the intent below. */
const GREETING_DOC = [
  '# Trivial Greeting',
  '',
  'hello welcome to the assistant. how can I help you today.',
  'what can I do for you, what do you need.',
].join('\n')

/** The trivial-turn intent — every token appears in GREETING_DOC's chunk body. */
const GREETING_INTENT = 'hello how can I help you what can I do for you today'

/** Mount the real reducer suite at a grade (matches boot.spec.ts composition). */
async function compose(grade: 'low' | 'med' | 'high' | 'xhigh'): Promise<{ ctx: Context; root: string }> {
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

describe('prompt-lume low trivial-turn cost measurement', () => {
  it('measures the REAL token-in of a trivial greeting under low from the cost event', async () => {
    const { ctx, root } = await compose('low')
    try {
      await ctx.promptCorpus.ingest(GREETING_DOC, { corpus: 'skills', scope: 'tooling' })

      const records: PromptLumeCostRecord[] = []
      ctx.on('prompt-lume/cost', (record) => { records.push(record) })

      ctx.promptLume.primeTurn({ intent: GREETING_INTENT, kind: 'tool' })
      await ctx.systemPrompt.assemble()

      // The region is staged for emission (low is still a wall — not zero).
      const regionText = emittedRegionText(ctx)
      expect(regionText).not.toBe('')

      // ONE measured cost record — the real numbers, captured not assumed.
      expect(records).toHaveLength(1)
      const record = records[0]!
      // low region byte budget (512) bounds the injected region — the real
      // measured bytes, asserted against the resolved low hook width.
      expect(record.regionBytes).toBeGreaterThan(0)
      expect(record.regionBytes).toBeLessThanOrEqual(512)
      // The real measured token components reconcile.
      expect(record.inputTokens).toBe(record.coreTokens + record.regionTokens)
      expect(record.regionTokens).toBeGreaterThan(0)
      // Provenance survives: the injected chunk carries the lume marker.
      expect(regionText).toContain('[prompt-lume]')
      // Fiat-attention guard: never overclaim; the record is the token-in.
      expect(record.budgetBytes).toBe(512)
      // Surfaces the REAL measured token-in so the TICK can record the
      // magnitude (measured, never fabricated or hardcoded).
      console.log(`LOW-MEASURE token-in=${record.inputTokens} core=${record.coreTokens} region=${record.regionTokens} regionBytes=${record.regionBytes} budget=${record.budgetBytes}`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

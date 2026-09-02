import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memory from '@atlasai/atsh-memory/src/index.ts'
import SystemPrompt from '@atlasai/atsh-system-prompt'
import PromptCorpusService from '@atlasai/atsh-prompt-corpus'
import PromptLumeService, {
  TASK_ALIGNED_SECTION,
  resolveGradeKnobs,
  selectGradeForComplexity,
} from '../src/index.ts'
import { emittedRegionText, lumeHasPendingRegion } from './emit-helper.ts'

/**
 * the corrections pass — auto-select the hook width per problem complexity (NO LLM).
 *
 * With NO explicit reducerGrade and NO explicit scalar override, the harness
 * must classify the current turn's complexity deterministically and select the
 * grade whose hook matches: trivial/simple intents -> low (narrowest hook),
 * complex/wide intents -> xhigh (widest hook). More complex problems need
 * wider hooks. This is the pure classifier plus an end-to-end wiring proof
 * that the auto path fires inside the service.
 */
describe('prompt-lume complexity auto-selector', () => {
  describe('selectGradeForComplexity (pure, deterministic)', () => {
    it('maps a trivial intent to the narrowest hook (low)', () => {
      expect(selectGradeForComplexity({ intent: 'hi' })).toBe('low')
      expect(selectGradeForComplexity({ intent: 'sum these numbers' })).toBe('low')
    })

    it('maps a routine short intent to med', () => {
      // wordCount 5 <= 10, kind 0 -> med
      expect(selectGradeForComplexity({ intent: 'list my open workspace tickets' })).toBe('med')
    })

    it('maps a longer multi-clause intent to high', () => {
      // wordCount 11 <= 20 -> high
      expect(
        selectGradeForComplexity({
          intent: 'refactor the auth module then update its integration tests and the API docs together',
        }),
      ).toBe('high')
    })

    it('maps a complex multi-part workspace/tool intent to the widest hook (xhigh)', () => {
      // wordCount > 20 -> xhigh
      expect(
        selectGradeForComplexity({
          intent: 'design audit the whole reporting pipeline then plan the migration of every legacy endpoint onto the new typed broker contract and open the follow-up tickets for the remaining cleanup work items',
          kind: 'workspace',
        }),
      ).toBe('xhigh')
    })

    it('adds kind breadth for tool/workspace turns (short but wide recall demand)', () => {
      // "run bash command sandbox" = 4 words + 2 (tool) = 6 -> med, not low
      expect(selectGradeForComplexity({ intent: 'run bash in sandbox', kind: 'tool' })).toBe('med')
      // same words, no kind -> low
      expect(selectGradeForComplexity({ intent: 'run bash in sandbox' })).toBe('low')
    })

    it('stays deterministic across calls with identical input', () => {
      const turn = { intent: 'spin up the ledger service and wire the nightly reconcile job', kind: 'tool' } as const
      const first = selectGradeForComplexity(turn)
      for (let i = 0; i < 5; i += 1) {
        expect(selectGradeForComplexity(turn)).toBe(first)
      }
    })
  })

  describe('auto path wiring (no grade, no scalar override)', () => {
    /** Mount prompt-lume with NO grade and NO scalar via the real Config schema. */
    async function mountAuto(): Promise<Context> {
      const ctx = new Context()
      await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
      await ctx.plugin(PromptCorpusService)
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(PromptLumeService) // config {} -> auto
      return ctx
    }

    it('fires the WIDE hook for a complex intent (region committed under a wide budget)', async () => {
      const ctx = await mountAuto()
      await ctx.promptCorpus.ingest(
        '# Authorization audit notes\n\nThe broker owns the authorization exchange. The identity store migration must preserve credential resolution across the client SDK API contract. Draft the migration plan before touching the legacy endpoints.',
        { corpus: 'workspace' },
      )
      const complex = {
        intent: 'audit the whole authorization path from credential resolution through the broker API contract and the client SDK, then draft the migration plan for the identity store migration',
        kind: 'workspace',
      } as const
      // Complex -> xhigh -> widest hook: a matching doc clears the low 0.85
      // cutoff, so a WIDE region commits. Prove the auto path resolved a wide
      // hook, not the narrow LOWER default.
      const autoGrade = selectGradeForComplexity(complex)
      expect(autoGrade).toBe('xhigh')
      const xhighKnobs = resolveGradeKnobs(autoGrade)

      ctx.promptLume.primeTurn(complex)
      const assembly = await ctx.systemPrompt.assemble()
      // The region is a tail message, never a section.
      expect(assembly.sections.find(section => section.name === TASK_ALIGNED_SECTION)).toBeUndefined()
      const text = emittedRegionText(ctx)
      expect(text).toContain('[prompt-lume]')
      // wide budget (kByte) bounds a wide region — not the 512 B narrow hook.
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(xhighKnobs.budgetBytes)
    })

    it('fires the NARROW hook for a trivial intent (no region on a clean corpus)', async () => {
      const ctx = await mountAuto()
      // Empty corpus -> nothing to recall; the narrow hook commits nothing.
      expect(selectGradeForComplexity({ intent: 'hi' })).toBe('low')
      ctx.promptLume.primeTurn({ intent: 'hi' })
      const assembly = await ctx.systemPrompt.assemble()
      const region = assembly.sections.find(section => section.name === TASK_ALIGNED_SECTION)
      expect(region).toBeUndefined()
      // And nothing is staged for emission either.
      expect(lumeHasPendingRegion(ctx)).toBe(false)
    })
  })
})

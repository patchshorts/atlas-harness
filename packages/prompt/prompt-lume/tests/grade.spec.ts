import { describe, expect, it } from 'vitest'
import { GRADE_ORDER, GRADE_HOOKS } from '../src/grade.ts'
import { resolveGradeKnobs } from '../src/index.ts'
import type { ReductionGrade } from '../src/grade.ts'

/**
 * the corrections pass — per-grade boundary contract (low < med < high < xhigh).
 *
 * The hook-width ladder is matched to problem COMPLEXITY. Low to xhigh the
 * retrieval hook WIDENS: the corpus search span grows, the ranking cutoff
 * lowers so more germane chunks clear commitment, the chunk commit count
 * grows, and the region byte budget grows. `low` keeps the NARROWEST hook =
 * the LEAST context = the simplest tasks; `xhigh` keeps the WIDEST hook = the
 * MOST context = the most complex problems. More complex problems need wider
 * hooks. Every grade is still behind a finite wall — a zero grade never
 * exists.
 *
 * This is the BOUNDARY spec: it pins every ADJACENT pair (low→med→high→xhigh)
 * to a strict monotonic step on EVERY hook-width field, plus a total ordering
 * over the ladder and the resolved-knob wall invariant. It stays separate
 * from grade-resolve.spec (which checks knob resolution + end wiring);
 * grade.spec owns the exhaustive adjacent boundary contract the grade.ts
 * docblock names explicitly.
 */

/** The four grades are a fixed ordered ladder with no aliases and no gaps. */
const EXPECTED_LADDER: readonly ReductionGrade[] = ['low', 'med', 'high', 'xhigh']

/**
 * The hook-WIDENING fields: as the grade increases (low→xhigh), each of these
 * strict-increases — a wider hook retains strictly MORE context. Restricted to
 * the NUMERIC fields (`label` is prose metadata, not hook math).
 */
type NumericFieldName = 'corpusSearchSpan' | 'chunkCommitCount' | 'regionByteBudget' | 'rankingCutoff'
const WIDENING: readonly NumericFieldName[] = [
  'corpusSearchSpan',
  'chunkCommitCount',
  'regionByteBudget',
]

/**
 * The hook-LOWERING field: the ranking cutoff DROPS as the grade increases, so
 * progressively more candidates clear commitment and more context is retained.
 * (`label` is prose metadata; not part of the numeric hook math.)
 */
const LOWERING_CUTOFF: NumericFieldName = 'rankingCutoff'

describe('prompt-lume per-grade boundary contract', () => {
  it('defines exactly the four-graded ladder low -> med -> high -> xhigh, no aliases', () => {
    expect(GRADE_ORDER).toEqual(EXPECTED_LADDER)
    expect(new Set(GRADE_ORDER).size).toBe(GRADE_ORDER.length)
    expect(Object.keys(GRADE_HOOKS).sort()).toEqual([...EXPECTED_LADDER].sort())
  })

  it('widens every hook-width field strictly across each ADJACENT pair (low < med < high < xhigh)', () => {
    for (let i = 0; i < GRADE_ORDER.length - 1; i += 1) {
      const narrower = GRADE_HOOKS[GRADE_ORDER[i]!]
      const wider = GRADE_HOOKS[GRADE_ORDER[i + 1]!]
      for (const field of WIDENING) {
        // Adjacent strict boundary: the next grade retains STRICTLY more
        // width than its predecessor on every widening field.
        expect(wider[field]).toBeGreaterThan(narrower[field])
      }
    }
  })

  it('lowers the ranking cutoff strictly across each ADJACENT pair (low > med > high > xhigh)', () => {
    for (let i = 0; i < GRADE_ORDER.length - 1; i += 1) {
      const narrower = GRADE_HOOKS[GRADE_ORDER[i]!]
      const wider = GRADE_HOOKS[GRADE_ORDER[i + 1]!]
      expect(narrower[LOWERING_CUTOFF]).toBeGreaterThan(wider[LOWERING_CUTOFF])
    }
  })

  it('yields a strict ascending hook-width ordering across the ladder (no ties, no plateaus)', () => {
    // Rank each grade as the sum of its normalized widening fields: a higher
    // rank is a wider hook = more retained context. The ladder must be
    // strictly monotonic in this total order, proving no grade is a duplicate
    // of the next and none sits on a plateau.
    const widthRank = (grade: ReductionGrade): number => {
      const hook = GRADE_HOOKS[grade]
      return WIDENING.reduce((sum, field) => sum + hook[field], 0)
    }
    for (let i = 0; i < GRADE_ORDER.length - 1; i += 1) {
      expect(widthRank(GRADE_ORDER[i]!)).toBeLessThan(widthRank(GRADE_ORDER[i + 1]!))
    }
  })

  it('keeps every grade behind a finite wall at the RESOLVED KNOBS level (no zero grade)', () => {
    // The hook rows are finite walls, but the ENFORCEABLE boundary is the
    // resolved knob set the service actually applies. No grade may resolve to
    // a zero budget or a zero commit cap — the wall is nonzero at every grade.
    for (const grade of GRADE_ORDER) {
      const knobs = resolveGradeKnobs(grade)
      expect(knobs.budgetBytes).toBeGreaterThan(0)
      expect(knobs.topK).toBeGreaterThanOrEqual(1)
      expect(knobs.searchSpan).toBeGreaterThanOrEqual(1)
      // The cutoff is a real gate in (0, 1): never 0 (nothing clears) and
      // never >= 1 (everything commits) — a discriminating finite wall.
      expect(knobs.rerankThreshold).toBeGreaterThan(0)
      expect(knobs.rerankThreshold).toBeLessThan(1)
    }
  })

  it('every grade carries a hook-width math label naming its width position', () => {
    for (const grade of GRADE_ORDER) {
      const hook = GRADE_HOOKS[grade]
      expect(hook.label.length).toBeGreaterThan(0)
      expect(hook.label).toContain(grade)
    }
  })
})

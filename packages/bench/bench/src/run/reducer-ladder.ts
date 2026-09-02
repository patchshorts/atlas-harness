/**
 * Within-arm prompt-lume reducer-grade ladder (broaden-design §4.4, the prior workstream T5b).
 *
 * The token study sweeps the reduction grade WITHIN one arm — `low`/`med`/
 * `high`/`xhigh` plus `off` — instead of comparing prompt-lume-vs-vanilla
 * across arms, which is exposed to provider prefix-cache variance. This module
 * is the single source of truth for the ladder: `bench-run --lume-grade` CLIs
 * derive their valid grade set from the same rows, so the knob and the sweep
 * can never drift.
 *
 * `off` is a real ladder cell here (disables the reducer), unlike
 * `@atlasai/atsh-prompt-lume`'s `ReductionGrade` (low/med/high/xhigh only,
 * no zero grade) — the study needs the counterfactual to anchor the sweep.
 *
 * Rows are ordered by hook width descending: low = widest hook (least
 * reduction) → xhigh = narrowest hook (most reduction), with `off` last as
 * the counterfactual anchor. No model calls; purely static config.
 * @module @atlasai/atsh-bench/run/reducer-ladder
 */

/** One cell of the within-arm reducer-grade ladder. */
export interface ReducerLadderRow {
  /** CLI-grade token accepted by `--lume-grade`. */
  grade: 'low' | 'med' | 'high' | 'xhigh' | 'off'
  /** Hook-width meaning relative to the other grades. */
  hook: string
  /** Measured trivial-turn input tokens for the grade (docs/prompt-lume.md §grades). */
  inputTokens: number | null
  /** Whether this cell is `off` (reducer disabled vs. a reduction grade). */
  disabled?: boolean
}

/**
 * The within-arm ladder, in sweep order: reduction grades from least to most
 * aggressive (widest hook → narrowest hook) then the `off` counterfactual.
 */
export const REDUCER_LADDER: readonly ReducerLadderRow[] = [
  { grade: 'low', hook: 'widest hook — retains the most context, least reduction', inputTokens: 761 },
  { grade: 'med', hook: 'medium hook — balance of retention and reduction', inputTokens: 394 },
  { grade: 'high', hook: 'narrow hook — more reduction', inputTokens: 210 },
  { grade: 'xhigh', hook: 'narrowest hook — most reduction, least context', inputTokens: 87 },
  { grade: 'off', hook: 'reducer disabled (counterfactual anchor)', inputTokens: null, disabled: true },
]

/** The valid `--lume-grade` tokens, derived from the ladder (CLI source of truth). */
export const LUME_GRADES: readonly string[] = REDUCER_LADDER.map(row => row.grade)

/** Is a grade token a valid ladder cell? (shared by CLI validation + tests). */
export function isLumeGrade(grade: string): grade is ReducerLadderRow['grade'] {
  return LUME_GRADES.includes(grade)
}

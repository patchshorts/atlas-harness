/**
 * Reduction grades for prompt-lume as the harness default context reducer.
 *
 * The grade is a HOOK-WIDTH ladder matched to problem complexity (not a pure
 * cost-reduction ladder). Hook WIDTH is driven by the retrieval hook that
 * decides how many corpus chunks commit into the assembled context. A WIDE
 * hook retains more context across complex, varied tasks; a NARROW hook
 * commits fewer, most-germane chunks for simple tasks. low is the NARROWEST
 * hook = the LEAST context = the simplest tasks; xhigh is the WIDEST hook =
 * the MOST context = the most complex problems. More complex problems need
 * wider hooks. Every grade is still a context wall — no zero grade exists.
 * Every grade composes the byte-stable core plus a finite task-aligned region
 * behind a finite wall.
 *
 * @module
 */

/**
 * The four hook-width grades, ordered from narrowest hook (low, simplest
 * tasks, least context) to widest hook (xhigh, most complex problems, most
 * context retained).
 *
 * `low` retains the NARROWEST hook — the LEAST context, suited to trivial,
 * well-bounded tasks. `xhigh` retains the WIDEST hook — the MOST context,
 * needed for complex problems. There is no zero grade.
 */
export type ReductionGrade =
  | 'low'
  | 'med'
  | 'high'
  | 'xhigh'

/** Grades ordered from narrowest hook (low) to widest hook (xhigh). */
export const GRADE_ORDER: readonly ReductionGrade[] = ['low', 'med', 'high', 'xhigh']

/**
 * The HOOK-WIDTH tuple for one grade: the retrieval/routing knobs that decide
 * how much context commits into the task-aligned region.
 *
 * Larger values across the tuple = wider hook = more context retained.
 * WIDE hook (more context) is the HIGH-complexity grade; NARROW hook (fewer,
 * most-germane chunks) is the LOW-complexity grade. The byte-stable core is
 * untouched at every grade — these knobs touch ONLY the retrieval/region path.
 */
export interface GradeHookWidth {
  /**
   * HOOK-WIDTH math label: the precise relation between the retrieval hook
   * and the context this grade retains. Drives the documentation + the
   * monotonic low<med<high<xhigh token-in ordering.
   */
  label: string
  /**
   * Corpus search span — how broadly recall over-fetches before ranking.
   * Wide = more corpus searched = more context committed per turn.
   */
  corpusSearchSpan: number
  /**
   * Ranking cutoff — the retrieval/ordering drop threshold. A narrower hook
   * rises the cutoff so only the most-germane chunks clear into commitment.
   */
  rankingCutoff: number
  /**
   * Chunk commit count — how many most-germane chunks may commit per turn.
   */
  chunkCommitCount: number
  /**
   * Region byte budget — the max bytes the task-aligned region may occupy.
   */
  regionByteBudget: number
}

/**
 * Per-grade HOOK-WIDTH rows (the fidelity table matched to complexity).
 *
 * Monotonicity is the contract: low is narrowest (fewest tokens), med and
 * high widen progressively, xhigh is widest (most tokens). Verification
 * (grade.spec) asserts low < med < high < xhigh across every tuple field —
 * the same ordering drives the bench-measured token-in progression.
 */
export const GRADE_HOOKS: Record<ReductionGrade, GradeHookWidth> = {
  low: {
    label: 'low: narrowest hook — the simplest, most well-bounded tasks retain the least context',
    corpusSearchSpan: 2,
    rankingCutoff: 0.85,
    chunkCommitCount: 1,
    regionByteBudget: 512,
  },
  med: {
    label: 'med: medium hook — routine tasks commit a few most-germane chunks',
    corpusSearchSpan: 4,
    rankingCutoff: 0.7,
    chunkCommitCount: 3,
    regionByteBudget: 2048,
  },
  high: {
    label: 'high: wide hook — complex tasks commit more context',
    corpusSearchSpan: 8,
    rankingCutoff: 0.5,
    chunkCommitCount: 6,
    regionByteBudget: 4096,
  },
  xhigh: {
    label: 'xhigh: widest hook — the most complex problems retain the MOST context',
    corpusSearchSpan: 12,
    rankingCutoff: 0.3,
    chunkCommitCount: 12,
    regionByteBudget: 8192,
  },
}

/** The minimal turn surface the complexity classifier reads. */
export interface ComplexityTurn {
  /** Working-intent text distilled from the user message + last agent action. */
  intent: string
  /** Turn kind: `tool` / `workspace` broaden the recall + scope demand. */
  kind?: 'tool' | 'workspace' | 'identity' | 'general'
}

/**
 * Deterministically classify a turn's complexity and select the matching hook
 * width (NO LLM). The score is wordCount(intent) + kindBreadth, where a
 * `tool`/`workspace` kind adds breadth because those demands span principles
 * (wide recall + scope) over a short phrase. More complex problems need wider
 * hooks: trivial intents select `low` (narrowest), the most complex select
 * `xhigh` (widest).
 *
 * @param turn - the current turn's distilled intent + optional kind.
 * @returns the hook-width grade whose width matches the complexity.
 */
export function selectGradeForComplexity(turn: ComplexityTurn): ReductionGrade {
  const wordCount = turn.intent.trim().split(/\s+/).filter(Boolean).length
  const kindBreadth = turn.kind === 'tool' || turn.kind === 'workspace' ? 2 : 0
  const score = wordCount + kindBreadth
  if (score <= 4) return 'low'
  if (score <= 10) return 'med'
  if (score <= 20) return 'high'
  return 'xhigh'
}

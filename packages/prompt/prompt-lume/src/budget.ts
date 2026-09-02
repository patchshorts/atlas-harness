/**
 * Byte-budget allocation for the prompt-lume task-aligned region.
 *
 * @module
 */

/** One rendered entry vying for the task-aligned region budget. */
export interface BudgetEntry {
  /** Fully rendered, provenance-labeled entry text (the bytes counted toward the budget). */
  text: string
  /** Corpus the chunk was ingested under (`skills`, `agent-instructions`, …). */
  corpus: string
  /** The cross-encoder rerank score in [0, 1]; the germane measure. */
  rerankScore: number
}

/** Options for {@link allocateBudget}. */
export interface BudgetOptions {
  /** Maximum bytes the task-aligned region may occupy. */
  budgetBytes: number
  /**
   * Most-germane corpora first (skills for tool turns, workspace instructions
   * for that dir, persona only when identity matters). Corpora not listed sort
   * after every listed corpus; an empty list keeps each entry's recall + rerank
   * order, scoping only by the byte budget.
   */
  corpusPriority?: readonly string[]
}

/**
 * Allocate a byte budget to the most-germane context entries.
 *
 * Sorts by corpus priority (listed corpora first, in the given order; unlisted
 * corpora after every listed corpus), then rerankScore descending, then the
 * input order for ties. Greedily accepts entries while the cumulative rendered
 * bytes stay within `budgetBytes`, dropping the least-germane tail when over
 * budget.
 *
 * Returns a new array; never mutates `entries`.
 */
export function allocateBudget(
  entries: readonly BudgetEntry[],
  options: BudgetOptions,
): BudgetEntry[] {
  const { budgetBytes, corpusPriority = [] } = options
  const priority = new Map(corpusPriority.map((corpus, index) => [corpus, index]))
  const ordered = entries
    .slice()
    .sort((a, b) => {
      const pa = priority.get(a.corpus) ?? Number.POSITIVE_INFINITY
      const pb = priority.get(b.corpus) ?? Number.POSITIVE_INFINITY
      if (pa !== pb) return pa - pb
      if (b.rerankScore !== a.rerankScore) return b.rerankScore - a.rerankScore
      return 0
    })
  const kept: BudgetEntry[] = []
  let bytes = 0
  for (const entry of ordered) {
    const size = Buffer.byteLength(entry.text, 'utf8')
    if (bytes + size > budgetBytes) continue
    kept.push(entry)
    bytes += size
  }
  return kept
}

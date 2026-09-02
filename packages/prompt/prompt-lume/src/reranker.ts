/**
 * Cross-encoder re-rank over prompt-corpus recall results.
 *
 * provider-callable scorer for the prompt-lume assembly path.
 *
 * @module
 */

/** One candidate chunk fed into the re-ranker (shape matches prompt-corpus PromptRecallResult). */
export interface RerankCandidate {
  id: string
  content: string
  namespace: string
  corpus: string
  /** backend recall relevance in [0,1]; 1 = every query token matched. */
  score: number
}

/** Provider-scoring function for a single (query, chunk) pair. */
export type CrossEncoderScore = (query: string, content: string) => number | Promise<number>

/** Options for {@link rerank}. */
export interface RerankOptions {
  /**
   * Provider-gated cross-encoder scorer. Omitted → shallow fallback:
   * recall order preserved (candidates already arrive ranked best-first from
   * prompt-corpus recall). When present, each candidate is re-scored, order
   * corrected to the cross-encoder score (descending), ties stable (keep the
   * richer-relative-to-recalled order).
   */
  encoder?: CrossEncoderScore
  /** Drop results whose final score < threshold. Default 0 (no drop). */
  threshold?: number
  /** Cap on returned chunk count. Default = candidates.length. */
  limit?: number
}

/** A re-ranked chunk: the candidate plus its final [0,1] rerankScore. */
export interface RerankedResult extends RerankCandidate {
  rerankScore: number
}

/**
 * Cross-encoder re-rank over prompt-corpus recall results.
 *
 * With an encoder: score every candidate, drop below `threshold`, order by
 * rerankScore descending (stable ties keep relative candidates order). Without
 * an encoder (the zero-provider default): preserve recall order (the shallow
 * fallback), keep candidates with score >= threshold, rerankScore = score.
 *
 * Returns a new array; never mutates `candidates`.
 */
export async function rerank(
  query: string,
  candidates: RerankCandidate[],
  options: RerankOptions = {},
): Promise<RerankedResult[]> {
  const { encoder, threshold = 0, limit = candidates.length } = options

  let results: RerankedResult[]

  if (encoder) {
    const scores = await Promise.all(candidates.map(c => encoder(query, c.content)))
    results = candidates.map((c, i) => ({ ...c, rerankScore: scores[i]! }))
    results.sort((a, b) => b.rerankScore - a.rerankScore)
  } else {
    // Shallow fallback: preserve recall order (already best-first).
    results = candidates.map(c => ({ ...c, rerankScore: c.score }))
  }

  const kept = results.filter(r => r.rerankScore >= threshold)
  return limit >= kept.length ? kept : kept.slice(0, limit)
}

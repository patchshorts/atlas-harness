/**
 * Lexical token-overlap ranking shared by the SQLite and pgvector memory backends: the recall
 * fallback when no embedding function is available. Pure and dependency-free.
 * @module @atlasai/atsh-memory/lexical
 */

/**
 * Split text into lowercased alphanumeric/underscore tokens for overlap scoring.
 * @param text - the text to tokenize.
 * @returns the lowercased token list (empty when no tokens match).
 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_]+/g) ?? []
}

/**
 * Rank `contentTokens` against `queryTokens`: matched query tokens / total query tokens, in
 * [0, 1]. An empty query scores 0 (nothing is relevant to nothing).
 * @param queryTokens - tokens of the recall query.
 * @param contentTokens - tokens of one stored record's content.
 * @returns the overlap score.
 */
export function lexicalScore(queryTokens: string[], contentTokens: string[]): number {
  if (queryTokens.length === 0) return 0
  const content = new Set(contentTokens)
  let matched = 0
  for (const token of queryTokens) {
    if (content.has(token)) matched++
  }
  return matched / queryTokens.length
}

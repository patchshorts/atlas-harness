/**
 * Lexicon matching for the bench classifier (C3 self-correction messages and
 * C5 user corrections).
 *
 * The lexicon is a config row frozen before any session runs (spec §2.2:
 * "exact match on lowercase message text"). Matching is deterministic:
 *
 * - the message text is lowercased once;
 * - a plain token matches when it appears as a whole word (`\b` boundaries on
 *   both sides) — `no` does not match `know` or `annotate`;
 * - a token containing `...` (e.g. `use ... instead`) matches when every
 *   non-empty part appears as a whole word (a fixed phrase with a variable
 *   middle, per the frozen lexicon row).
 *
 * @module @atlasai/atsh-bench/classify/lexicon
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whole-word match of one token against lowercased text. */
function hasWord(lowerText: string, token: string): boolean {
  if (token.length === 0) return false
  return new RegExp(`\\b${escapeRegExp(token)}\\b`).test(lowerText)
}

/**
 * True when the lowercased message text matches any frozen lexicon token.
 *
 * @param text - the raw (un-lowercased) message text.
 * @param tokens - the frozen C3/C5 token list (spec §2.2).
 */
export function matchLexicon(text: string, tokens: readonly string[]): boolean {
  const lower = text.toLowerCase()
  for (const token of tokens) {
    const t = token.toLowerCase()
    if (t.includes('...')) {
      const parts = t.split('...').map(part => part.trim()).filter(part => part.length > 0)
      if (parts.length === 0) continue
      if (parts.every(part => hasWord(lower, part))) return true
    } else if (hasWord(lower, t)) {
      return true
    }
  }
  return false
}

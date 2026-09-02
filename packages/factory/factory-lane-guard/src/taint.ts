// Taint-aware verification for the in-band class (extraction-then-composition).
// The real extraction is a model pass; the verifier operates on whatever
// triples were extracted — the heuristic keeps the deterministic test suite
// self-contained. Pure functions — no I/O, no this: outputs are derived,
// inputs are never mutated (golden rule).

import type { FactTriple, TaintVerdict } from './types.ts'

/**
 * Heuristically extract fact triples from content (deterministic stand-in
 * for the model extraction pass).
 *
 * @param content - the source content.
 * @param max - maximum number of triples (default 64).
 * @returns the extracted triples (lowercased, trimmed).
 */
export function toTriples(content: string, max = 64): FactTriple[] {
  const sentences = content.split(/[.!?\n]+/).map(sentence => sentence.trim()).filter(sentence => sentence.length > 0)
  const triples: FactTriple[] = []
  for (const sentence of sentences) {
    if (triples.length >= max) break
    const words = sentence.toLowerCase().split(/\s+/).filter(word => word.length > 0)
    if (words.length >= 4) {
      // subject = first 2 words, predicate = next 2 words, object = the rest
      triples.push({
        subject: words.slice(0, 2).join(' '),
        predicate: words.slice(2, 4).join(' '),
        object: words.slice(4).join(' '),
      })
    } else if (words.length === 3) {
      triples.push({ subject: words[0] ?? '', predicate: words[1] ?? '', object: words[2] ?? '' })
    } else if (words.length === 2) {
      triples.push({ subject: words[0] ?? '', predicate: words[1] ?? '', object: '' })
    } else if (words.length === 1) {
      triples.push({ subject: words[0] ?? '', predicate: '', object: '' })
    }
  }
  return triples
}

/**
 * Whether a clause traces to a triple: the triple's object (non-empty)
 * appears in the clause, OR the triple's subject AND predicate both appear.
 *
 * @param clause - the output clause text.
 * @param triples - the extracted fact triples.
 * @returns the traced triple, or null when the clause traces to none.
 */
export function clauseTraces(clause: string, triples: FactTriple[]): FactTriple | null {
  const lower = clause.toLowerCase()
  for (const triple of triples) {
    if (triple.object !== '' && lower.includes(triple.object)) return triple
    if (triple.subject !== '' && triple.predicate !== '' && lower.includes(triple.subject) && lower.includes(triple.predicate)) {
      return triple
    }
  }
  return null
}

/**
 * Verify a composed output against the extracted triples: split the output
 * into clauses; traced clauses pass, untraced clauses are collected.
 * A clause is "flagged and dropped" by the CALLER — this function reports
 * the flags (the verifier is a filter, never a single-point guarantee —
 * Fix 13 note).
 *
 * @param output - the composed output text.
 * @param triples - the fact triples extracted from CONTENT.
 * @returns the verdict: verified, traced clause count, and untraced clauses.
 */
export function verifyTaintedComposition(output: string, triples: FactTriple[]): TaintVerdict {
  const clauses = output.split(/[.!?;\n]+/).map(clause => clause.trim()).filter(clause => clause.length > 0)
  const untraced: string[] = []
  let traced = 0
  for (const clause of clauses) {
    if (clauseTraces(clause, triples) !== null) {
      traced += 1
    } else {
      untraced.push(clause)
    }
  }
  return { verified: untraced.length === 0, traced, untraced }
}

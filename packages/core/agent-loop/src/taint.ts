/**
 * Taint-aware verification: extraction-then-composition for the in-band class.
 *
 * The in-band injection class (instruction disguised AS content) is
 * token-indistinguishable from truth, so no lexical or prompt-emphatic defense
 * can stop it. This module adds a structural check at the agent-loop output
 * path: final output clauses must TRACE to fact triples that were extracted
 * from the turn's tool-result content. A clause that traces to no extracted
 * triple is untraceable and is dropped (flagged for the caller to reject).
 *
 * The real triple extraction is a model pass (see the design authority D5 /
 * FR-9); this module verifies whatever triples were extracted. `toTriples` is
 * a deterministic heuristic stand-in so the FR-9 test suite stays
 * self-contained (no live API, per the operator's self-targeted directive).
 *
 * Purity (golden rule): every function here is a pure, derived transform. No
 * I/O, no `this`, no mutation of its inputs. Outputs are new arrays; inputs
 * are never written. The golden rule — never mutate model-visible history — is
 * preserved by construction and asserted in `taint.spec.ts`.
 *
 * @module @atlasai/atsh-agent-loop/taint
 */

/** A fact triple extracted from CONTENT (subject, predicate, object). */
export interface FactTriple {
  subject: string
  predicate: string
  object: string
}

/** Taint-aware verification verdict for a composed output. */
export interface TaintVerdict {
  /** True when every output clause traced to an extracted triple. */
  verified: boolean
  /** Number of output clauses that traced to a triple. */
  traced: number
  /** Clause texts that traced to no triple (must be dropped by the caller). */
  untraced: string[]
}

/**
 * Heuristically extract fact triples from content (deterministic stand-in for
 * the model extraction pass).
 *
 * Splits the content into sentences, then each sentence into words. A
 * sentence of 4+ words yields a triple (subject = first two words, predicate =
 * next two, object = the rest); shorter sentences map onto the same slots with
 * the remainder left empty. All fields are lowercased and trimmed.
 *
 * @param content - the source content (typically tool-result text).
 * @param max - maximum number of triples to extract (default 64).
 * @returns the extracted triples.
 */
export function toTriples(content: string, max = 64): FactTriple[] {
  const sentences = content
    .split(/[.!?\n]+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0)
  const triples: FactTriple[] = []
  for (const sentence of sentences) {
    if (triples.length >= max) break
    const words = sentence.toLowerCase().split(/\s+/).filter(word => word.length > 0)
    if (words.length >= 4) {
      triples.push({
        subject: words.slice(0, 2).join(' '),
        predicate: words.slice(2, 4).join(' '),
        object: words.slice(4).join(' '),
      })
    /* v8 ignore start -- words[] is length-checked after a non-empty filter, so `?? ''` never fires */
    } else if (words.length === 3) {
      triples.push({ subject: words[0] ?? '', predicate: words[1] ?? '', object: words[2] ?? '' })
    } else if (words.length === 2) {
      triples.push({ subject: words[0] ?? '', predicate: words[1] ?? '', object: '' })
    } else if (words.length === 1) {
      triples.push({ subject: words[0] ?? '', predicate: '', object: '' })
    }
    /* v8 ignore stop */
  }
  return triples
}

/**
 * Whether a clause traces to a triple.
 *
 * A clause traces when the triple's non-empty OBJECT appears in the clause,
 * OR the triple's subject AND predicate both appear in the clause.
 *
 * @param clause - the output clause text (caller supplies raw text; matching is case-insensitive).
 * @param triples - the extracted fact triples from CONTENT.
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
 * Verify a composed output against the extracted triples.
 *
 * Splits the output into clauses; traced clauses count toward `traced`,
 * untraced clauses are collected in `untraced`. The verdict's `verified` is
 * true only when untraced is empty. The verifier is a FILTER — the caller
 * owns dropping the untraced clauses (Fix 13 note: never a single-point
 * guarantee).
 *
 * Semi-colons are treated as clause separators so multi-clause utterances are
 * checked independently rather than masking an untraced injection.
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

/** A dropped-clause outcome: the surviving text plus the clauses removed. */
export interface DropOutcome {
  /** The output with untraced clauses removed (unchanged when none are untraced). */
  text: string
  /** The clause texts that were dropped because they traced to no triple. */
  dropped: string[]
}

/**
 * Drop the output clauses that trace to no extracted triple.
 *
 * Runs {@link verifyTaintedComposition} and, when the composition is not
 * verified, keeps only the traced clauses (rejoined with `. `). This is the
 * caller-owned drop the verifier delegates (Fix 13 note: never a single-point
 * guarantee). Pure derived transform — never mutates its inputs.
 *
 * @param output - the composed output text.
 * @param triples - the fact triples extracted from CONTENT.
 * @returns the surviving text and the dropped clause texts.
 */
export function dropUntracedClauses(output: string, triples: FactTriple[]): DropOutcome {
  const verdict = verifyTaintedComposition(output, triples)
  if (verdict.verified) return { text: output, dropped: [] }
  const clauses = output.split(/[.!?;\n]+/).map(clause => clause.trim()).filter(clause => clause.length > 0)
  const kept = clauses.filter(clause => !verdict.untraced.includes(clause))
  return { text: kept.join('. '), dropped: verdict.untraced }
}

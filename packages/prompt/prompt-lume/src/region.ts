/**
 * Provenance labeling and render-safe escaping for the prompt-lume task-aligned
 * region.
 *
 * @module
 */

import type { RerankedResult } from './reranker.ts'

/** Section name of the provenance-labeled task-aligned region prompt-lume injects. */
export const TASK_ALIGNED_SECTION = 'lume:task-aligned'

/** Leading marker line of the task-aligned region (stable model-visible text). */
export const TASK_ALIGNED_HEADER = 'Relevant working context (retrieved by prompt-lume):'

/**
 * Neutralize template braces in retrieved corpus text.
 *
 * Corpus chunks are reference material, not prompt templates: a `{{name}}`
 * group inside retrieved content must render verbatim and never be re-parsed by
 * `renderPrompt` (which throws on malformed or unknown variables). Splitting
 * every `{{` into `{ {` breaks the adjacency so no reference group matches; a
 * lone `}}` is never scanned. The stable core is untouched, so cache stability
 * survives; only the per-turn region (which is not byte-stable) is escaped.
 */
export function neutralizePromptText(text: string): string {
  return text.replaceAll('{{', '{ {')
}

/** One line of provenance labeling the source of an injected chunk. */
export function provenanceFor(chunk: RerankedResult, intent: string): string {
  return `[prompt-lume] corpus=${chunk.corpus} score=${chunk.rerankScore.toFixed(2)} for "${intent}"`
}

/**
 * Render one provenance-labeled, brace-escaped entry.
 *
 * The provenance line precedes the (escaped) chunk body so every injected chunk
 * is attributable — never an unlabeled injection.
 */
export function renderEntry(chunk: RerankedResult, intent: string): string {
  return `${provenanceFor(chunk, intent)}\n${neutralizePromptText(chunk.content)}`
}

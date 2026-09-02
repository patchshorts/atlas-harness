/**
 * Semantic-boundary chunking for the prompt-corpus RAG index.
 *
 * Splits an instruction corpus document (system sections, persona blocks,
 * AGENTS.md/CLAUDE.md files, SKILL.md frontmatter+body, SOUL entries) into typed
 * chunks at semantic boundaries — ATX headings and sections — rather than at a
 * fixed N-token window. Each chunk carries the metadata the relevance-gated
 * assembler needs: which corpus it came from, its scope, a specificity rank
 * (deeper heading = more specific), and a cache-stability flag telling
 * `prompt-lume` whether this chunk may live in the byte-stable cached core.
 *
 * @module @atlasai/atsh-prompt-corpus/chunker
 */

/**
 * One semantic chunk of a corpus document.
 *
 * `content` is the heading line (when present) plus the section body up to the
 * next heading. `specificityRank` is 1 + the heading depth (H1 = 1 ... H6 = 6);
 * preamble before the first heading gets rank 0 (least specific). Higher rank
 * means the chunk answers a narrower, more specific query. `cacheStable` is
 * true only when the chunk carries no per-turn `{{variable}}` interpolation,
 * so it may sit in the byte-identical cached core.
 */
export interface PromptCorpusChunk {
  /** Ordinal position in the source document, 0-based. */
  index: number
  /** The ATX heading text that starts this section, without `#` markers; empty for preamble. */
  heading: string
  /** Heading depth (1..6) for headed chunks; 0 for preamble. */
  depth: number
  /** Specificity rank; higher = more specific (see {@link PromptCorpusChunk}). */
  specificityRank: number
  /** The heading line plus body, verbatim. */
  content: string
  /** Named corpus this chunk was extracted from (e.g. `system`, `persona`, `agent-instructions`, `skill`, `soul`). */
  corpus: string
  /** Scope within the corpus (e.g. a directory, skill id, or block name). */
  scope: string
  /** True when the chunk may live in the byte-stable cached core (no per-turn variables). */
  cacheStable: boolean
}

/** Options for {@link chunkDocument}. */
export interface ChunkOptions {
  /** Name of the corpus the document belongs to. Default `'system'`. */
  corpus?: string
  /** Scope within the corpus. Default `''`. */
  scope?: string
}

/** ATX heading regex: 1-6 `#` followed by a space and the heading text. */
const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*$/

/** Per-turn interpolation markers that disqualify a chunk from the cached core. */
const PER_TURN_VAR = /\{\{[\s\S]*?\}\}/

/**
 * Whether a chunk body is safe to cache byte-stable across turns.
 *
 * A chunk with no `{{variable}}` interpolation is safe: its bytes never change
 * from per-turn state, so the provider cache-read path on the cached core
 * survives. Any interpolation marker forces `false` so the assembler places it
 * in the task-aligned (non-cached) region.
 */
function isCacheStable(content: string): boolean {
  return !PER_TURN_VAR.test(content)
}

/**
 * Split a corpus document into semantic chunks at heading boundaries.
 *
 * Preamble before the first ATX heading becomes its own rank-0 chunk. Each
 * heading starts a new chunk whose `content` runs to the next heading line.
 * Every chunk is tagged with `corpus`, `scope`, `specificityRank`, and
 * `cacheStable` so downstream retrieval and the budget allocator can act on it
 * without re-parsing.
 *
 * @param document - the corpus text to chunk.
 * @param options - corpus + scope labels applied to every chunk.
 * @returns the ordered list of chunks covering the whole document.
 */
export function chunkDocument(document: string, options: ChunkOptions = {}): PromptCorpusChunk[] {
  const { corpus = 'system', scope = '' } = options
  const chunks: PromptCorpusChunk[] = []
  const lines = document.split(/\r?\n/)

  let index = 0
  let currentHeading = ''
  let currentDepth = 0
  let currentLines: string[] = []
  let sawHeading = false

  const flush = (): void => {
    if (currentLines.length === 0) return
    const body = currentLines.join('\n').trimEnd()
    if (body.length === 0) return
    const depth = currentDepth
    // Preamble (no heading seen yet) stays at rank 0 — least specific.
    const specificityRank = sawHeading ? depth : 0
    chunks.push({
      index: index++,
      heading: currentHeading,
      depth,
      specificityRank,
      content: body,
      corpus,
      scope,
      cacheStable: isCacheStable(body),
    })
  }

  for (const raw of lines) {
    const match = ATX_HEADING.exec(raw.trimEnd())
    if (match) {
      flush()
      currentDepth = match[1]?.length ?? 0
      currentHeading = match[2]?.trim() ?? ''
      // Keep the heading line so the chunk is self-describing for the model.
      currentLines = [raw]
      sawHeading = true
    } else {
      currentLines.push(raw)
    }
  }
  flush()
  return chunks
}

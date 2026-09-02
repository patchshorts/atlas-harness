/**
 * RAG index over instruction corpora on the MemoryStore recall seam.
 *
 * `PromptCorpusService` registers `ctx.promptCorpus`: a relevance-gated index
 * over instruction corpora (AGENTS.md/CLAUDE.md, SKILL.md bodies, system and
 * persona blocks, SOUL entries). It reuses the existing `ctx.memoryStore`
 * remove-verify seam — no new engine. {@link PromptCorpusService.ingest}
 * chunks a document at semantic boundaries and retains every chunk as a typed
 * record in the memory store; {@link PromptCorpusService.reflect} reports the
 * indexed chunk counts. {@link PromptCorpusService.recall} routes the hybrid
 * MemoryStore recall seam (lexical default, embedding-optional) scoped to the
 * prompt-corpus index and returns the ranked chunks.
 *
 * Namespacing: every chunk is retained in the `prompt:<corpus>` namespace so
 * prompt-corpus chunks are addressable independently of ordinary agent memory
 * and recall can scope to one corpus (skills for tool turns, workspace
 * instructions for that dir) or span them.
 *
 * @module @atlasai/atsh-prompt-corpus
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  MemoryReflectOptions,
  MemoryStore,
} from '@atlasai/atsh-memory'
import { chunkDocument, type ChunkOptions } from './chunker.ts'

export { chunkDocument } from './chunker.ts'
export type { PromptCorpusChunk, ChunkOptions } from './chunker.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    promptCorpus: PromptCorpusService
  }
}

/** Namespace prefix that marks a memory record as a prompt-corpus chunk. */
export const PROMPT_NAMESPACE = 'prompt:'

/** Options for {@link PromptCorpusService.ingest}. */
export interface IngestOptions extends ChunkOptions {
  /** Optional namespace override; defaults to `prompt:<corpus>`. */
  namespace?: string
}

/** Result of {@link PromptCorpusService.ingest}. */
export interface IngestResult {
  /** Number of chunks retained into the memory store. */
  retained: number
  /** Corpus the chunks were tagged with. */
  corpus: string
  /** Scope the chunks were tagged with. */
  scope: string
  /** Namespace the chunks were retained under. */
  namespace: string
}

/** Summary shape from {@link PromptCorpusService.reflect}. */
export interface PromptCorpusSummary {
  /** Total prompt-corpus chunks currently indexed. */
  total: number
  /** Chunk count per corpus, keyed by corpus name (prefix stripped). */
  byCorpus: Record<string, number>
}

/** Options for {@link PromptCorpusService.recall}. */
export interface PromptRecallOptions {
  /** Maximum number of ranked chunks to return; default 10. */
  limit?: number
  /** Scope recall to a single corpus by name (e.g. `'skills'`); undefined spans all prompt corpora. */
  corpus?: string
}

/** One ranked prompt-corpus chunk returned by {@link PromptCorpusService.recall}. */
export interface PromptRecallResult {
  /** Memory-store record id of the retained chunk. */
  id: string
  /** The chunk content (headline + body), verbatim. */
  content: string
  /** Memory-store namespace the chunk lives under (`prompt:<corpus>`). */
  namespace: string
  /** Corpus name the chunk belongs to (namespace prefix stripped). */
  corpus: string
  /** Backend relevance score in [0, 1]; 1 = every query token matched. */
  score: number
}

/**
 * Register `ctx.promptCorpus` — the L2 RAG index over instruction corpora
 * served on the MemoryStore seam.
 *
 * Consumers receive the memory store via the declared `memoryStore` injection
 * (load ordering + typed `ctx.memoryStore` access); the constructor runs
 * synchronously, so `ctx.promptCorpus` is available as soon as this service's
 * load settles.
 *
 * @memberof module:prompts/prompt-corpus
 */
export class PromptCorpusService extends Service {
  static inject = ['memoryStore']

  constructor(ctx: Context) {
    super(ctx, 'promptCorpus')
  }

  private get memoryStore(): MemoryStore {
    return this.ctx.memoryStore
  }

  /**
   * Chunk a corpus document at semantic boundaries and retain each typed chunk
   * into the memory store under the `prompt:<corpus>` namespace.
   *
   * Every record carries structured metadata: `kind: 'prompt-corpus-chunk'`,
   * `corpus`, `scope`, `specificityRank`, `cacheStable`, plus the chunk's
   * `index`, `heading`, and `depth`. This is the metadata later stages (recall
   * routing, cross-encoder re-rank, budget allocation) act on, so the model /
   * assembler never re-parses the corpus.
   *
   * @param document - the corpus text to index.
   * @param options - corpus/scope labels plus an optional namespace override.
   * @returns counts + labels of the retained chunks.
   */
  async ingest(document: string, options: IngestOptions = {}): Promise<IngestResult> {
    const { namespace, ...chunkOptions } = options
    const { corpus = 'system', scope = '' } = chunkOptions
    const ns = namespace ?? `${PROMPT_NAMESPACE}${corpus}`
    const chunks = chunkDocument(document, { corpus, scope })
    for (const chunk of chunks) {
      await this.memoryStore.retain({
        content: chunk.content,
        namespace: ns,
        metadata: {
          kind: 'prompt-corpus-chunk',
          corpus: chunk.corpus,
          scope: chunk.scope,
          specificityRank: chunk.specificityRank,
          cacheStable: chunk.cacheStable,
          index: chunk.index,
          heading: chunk.heading,
          depth: chunk.depth,
        },
      })
    }
    return { retained: chunks.length, corpus, scope, namespace: ns }
  }

  /**
   * Report the prompt-corpus index size: total retained chunks and the count
   * per corpus.
   *
   * @param opts - optional namespace scope to limit the summary.
   * @returns total chunk count and per-corpus breakdown.
   */
  async reflect(opts?: MemoryReflectOptions): Promise<PromptCorpusSummary> {
    const summary = await this.memoryStore.reflect(opts)
    const byCorpus: Record<string, number> = {}
    for (const [ns, count] of Object.entries(summary.byNamespace)) {
      if (ns.startsWith(PROMPT_NAMESPACE)) {
        byCorpus[ns.slice(PROMPT_NAMESPACE.length) || ns] = count
      }
    }
    const scopedTotal = Object.values(byCorpus).reduce((sum, n) => sum + n, 0)
    return { total: scopedTotal, byCorpus }
  }

  /**
   * Rank the prompt-corpus index against a query and return the best chunks.
   *
   * The router delegates to the underlying MemoryStore hybrid recall (lexical
   * overlap by default; embeddings when the backend is configured with one), so
   * it works with zero embedding config out of the box. When a single corpus is
   * named, recall runs scoped to that corpus' `prompt:<corpus>` namespace; when
   * no corpus is named it spans all prompt corpora. Results keep their 0..1
   * backend score and the corpus label each chunk was ingested under, so an
   * assembler can order by germane corpus (skills for tool turns, workspace
   * instructions for that dir) without re-parsing the store.
   *
   * @param query - the working-intent text to match chunks against.
   * @param options - result limit and optional single-corpus scope.
   * @returns ranked chunks, best first, capped at `limit` (default 10).
   */
  async recall(query: string, options: PromptRecallOptions = {}): Promise<PromptRecallResult[]> {
    const limit = options.limit ?? 10
    const matches =
      options.corpus !== undefined
        ? await this.memoryStore.recall(query, {
          namespace: `${PROMPT_NAMESPACE}${options.corpus}`,
          limit,
        })
        : (await this.memoryStore.recall(query, {
          limit: Math.max(limit * 3, 30),
        }))
          .filter(result => result.namespace.startsWith(PROMPT_NAMESPACE))
          .slice(0, limit)
    return matches.map(result => ({
      id: result.id,
      content: result.content,
      namespace: result.namespace,
      corpus: result.namespace.slice(PROMPT_NAMESPACE.length),
      score: result.score,
    }))
  }
}

export default PromptCorpusService

/**
 * Deterministic + semantic LLM response cache (`ctx.llmCache`): intercepts the
 * `llm/stream` Cordis waterfall, serves cached completions without an upstream call,
 * and stores completed responses on miss.
 *
 * Two tiers share one `llm_cache` table:
 * - **Exact tier** — a sha256 over a canonical subset of the request (`provider`,
 *   `model`, `purpose`, `system`, `temperature`, `messages`, `tools`) keys the cache.
 *   A byte-identical request is replayed from the stored chunks and `next()` is never
 *   called — this is the cache's intentional veto: the caller gets the completion
 *   without any upstream LLM hit.
 * - **Semantic tier** (default off) — on an exact miss, the request's message
 *   embedding is compared against every stored embedding; a row scoring at or above
 *   `semanticThreshold` cosine is served as a near-match. Gated by default because
 *   serving a near-match to a *different* prompt changes model-visible content.
 *
 * The handler only READS `options` (canonical stringify + message embedding); a
 * deep-frozen loop-built request is never mutated. On miss the inner stream is always
 * called and wrapped: chunks are forwarded verbatim and collected, and the row is
 * stored only when the stream completes successfully — an error re-throws without
 * storing anything.
 *
 * @module @atlasai/atsh-cache/service
 */

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { GenerateOptions, StreamChunk } from '@atlasai/atsh-llm'
import type { CacheConfig, CacheSource, CacheStats, Embedder } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llmCache: LlmCache
  }
}

const SUPPORTED_CONFIG_KEYS = new Set([
  'enabled',
  'exact',
  'semantic',
  'semanticThreshold',
  'sqlite',
])

/** Reject stale or misspelled config keys before defaults can hide them. */
function validateConfigKeys(config: CacheConfig): void {
  for (const key of Object.keys(config)) {
    if (!SUPPORTED_CONFIG_KEYS.has(key)) {
      throw new Error(`CacheConfig: unknown key "${key}"`)
    }
  }
}

/** One physical `llm_cache` row as read back by the service. */
interface CacheRow {
  key: string
  source: string
  chunks: string
  embedding: string | null
  hit_count: number
}

/**
 * Open (creating if needed) the cache database and ensure the `llm_cache` table exists.
 * `:memory:` skips all filesystem setup; a file path creates missing parent directories.
 * @param path - database file path or `:memory:`.
 * @returns the open handle with the schema ensured.
 */
function openDatabase(path: string): DatabaseSync {
  const actual = path === ':memory:' ? ':memory:' : resolve(path)
  if (actual !== ':memory:') {
    mkdirSync(dirname(actual), { recursive: true, mode: 0o700 })
  }
  const db = new DatabaseSync(actual)
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_cache (
      key       TEXT PRIMARY KEY,
      source    TEXT NOT NULL,
      chunks    TEXT NOT NULL,
      embedding TEXT,
      hit_count INTEGER NOT NULL DEFAULT 0,
      ts        INTEGER NOT NULL
    )
  `)
  return db
}

/**
 * Canonical sha256 key over the model-visible request subset. `JSON.stringify`
 * deterministically drops `undefined` fields, so a request differing only in
 * model-invisible fields (`signal`, `sessionId`, ...) still keys identically.
 * @param options - the full request (read only, never mutated).
 * @returns hex sha256 of the canonical subset.
 */
function exactHash(options: GenerateOptions): string {
  const canonical = {
    provider: options.provider,
    model: options.model,
    purpose: options.purpose,
    system: options.system,
    temperature: options.temperature,
    messages: options.messages,
    tools: options.tools,
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

const EMBEDDING_DIM = 256

/** FNV-1a string hash, used to scatter tokens into the bag-of-words vector. */
function hashToken(token: string): number {
  let hash = 2166136261
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** L2-normalize a vector; a zero vector stays zero (cosine with it is 0). */
function l2Normalize(vector: number[]): number[] {
  let normSq = 0
  for (const value of vector) normSq += value * value
  const norm = Math.sqrt(normSq)
  if (norm === 0) return vector
  return vector.map(value => value / norm)
}

/** Extract the text of one message: a string `content`, or the `text` blocks of a block array. */
function messageText(message: unknown): string {
  if (message === null || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    let text = ''
    for (const block of content) {
      if (
        block !== null &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text'
      ) {
        const blockText = (block as { text?: unknown }).text
        if (typeof blockText === 'string') text += ` ${blockText}`
      }
    }
    return text
  }
  return ''
}

/**
 * Deterministic local bag-of-words embedder: lowercase tokens (`/\W+/` split) are hashed
 * into a fixed 256-dim count vector, then L2-normalized. Purely deterministic — no
 * `Math.random`, no network — so the same messages always produce the same vector and
 * the semantic tier is stable across runs. Production deployments swap in a real
 * embedding model via the public {@link LlmCache.embedder} property.
 * @param messages - the request's messages (unknown-shape tolerant).
 * @returns the normalized embedding vector.
 */
function defaultEmbedder(messages: unknown[]): number[] {
  const vector = new Array<number>(EMBEDDING_DIM).fill(0)
  for (const message of messages) {
    for (const raw of messageText(message).split(/\W+/)) {
      const token = raw.toLowerCase()
      if (token.length === 0) continue
      const index = hashToken(token) % EMBEDDING_DIM
      vector[index] = (vector[index] ?? 0) + 1
    }
  }
  return l2Normalize(vector)
}

/** Cosine similarity between two equal-length vectors; `0` when either is zero. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dot / denominator
}

/**
 * Deterministic + semantic LLM response cache. Load as a plugin
 * (`ctx.plugin(LlmCache, config)`); it registers as `ctx.llmCache` (one cache per
 * context — loading a second throws, cordis' standard duplicate-service behavior) and,
 * when enabled, listens on the `llm/stream` waterfall. The SQLite backend closes when
 * the owning fiber unloads.
 */
export class LlmCache extends Service {
  static Config: z<CacheConfig> = z.object({
    enabled: z.boolean(),
    exact: z.boolean(),
    semantic: z.boolean(),
    semanticThreshold: z.number(),
    sqlite: z.object({ path: z.string() }),
  })

  /** Open cache database handle (public for tests/inspection). */
  readonly db: DatabaseSync

  /**
   * Message → vector embedder for the semantic tier. Defaults to a deterministic local
   * bag-of-words embedder; production deployments assign a real embedding model here.
   */
  embedder: Embedder = defaultEmbedder

  private readonly exact: boolean
  private readonly semantic: boolean
  private readonly semanticThreshold: number

  constructor(ctx: Context, config: CacheConfig) {
    super(ctx, 'llmCache')
    validateConfigKeys(config)
    this.exact = config.exact ?? true
    this.semantic = config.semantic ?? false
    this.semanticThreshold = config.semanticThreshold ?? 0.9
    this.db = openDatabase(config.sqlite?.path ?? ':memory:')
    this.ctx.effect(() => () => {
      this.db.close()
    }, 'dsh-cache: close sqlite database')
    if (config.enabled ?? true) {
      this.ctx.on('llm/stream', (options, next) => this.handleStream(options, next))
    }
  }

  /**
   * Snapshot of the table-level counters: rows, total hits served, rows never served
   * from cache, and `hits / (hits + misses)` (`0` when nothing has been served).
   * @returns the cache table counters.
   */
  getStats(): CacheStats {
    const count = (sql: string): number => {
      const row = this.db.prepare(sql).get() as { n: number } | undefined
      return row?.n ?? 0
    }
    const entries = count('SELECT COUNT(*) AS n FROM llm_cache')
    const hits = count('SELECT COALESCE(SUM(hit_count), 0) AS n FROM llm_cache')
    const misses = count('SELECT COUNT(*) AS n FROM llm_cache WHERE hit_count = 0')
    const served = hits + misses
    return { entries, hits, misses, hitRate: served === 0 ? 0 : hits / served }
  }

  /**
   * Intercept one `llm/stream` call: exact lookup first, then (when enabled) the
   * semantic tier, then the miss path. A hit replays the stored chunks and never calls
   * `next()`; a miss emits `cache/miss`, calls `next()`, and wraps the stream so the
   * completion is stored on success.
   * @param options - the full request (read only, never mutated).
   * @param next - the composed inner chain (adapter stream).
   * @returns the served or wrapped stream.
   */
  private handleStream(
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncIterable<StreamChunk> {
    const key = exactHash(options)

    if (this.exact) {
      const row = this.lookupRow(key)
      if (row !== undefined) return this.serveHit(row, 'exact')
    }

    if (this.semantic) {
      const best = this.bestSemanticMatch(this.embedder(options.messages))
      if (best !== undefined) return this.serveHit(best, 'semantic')
    }

    this.ctx.emit('cache/miss', { key, ts: Date.now() })
    return this.capture(key, options, next)
  }

  /** Read one row by exact key, or `undefined`. */
  private lookupRow(key: string): CacheRow | undefined {
    const row = this.db.prepare(
      'SELECT key, source, chunks, embedding, hit_count FROM llm_cache WHERE key = ?',
    ).get(key) as CacheRow | undefined
    return row
  }

  /**
   * Serve one hit: emit `cache/hit` with the tier, bump the row's hit counter, and
   * replay the stored chunks in order without touching the upstream chain.
   */
  private serveHit(row: CacheRow, source: CacheSource): AsyncIterable<StreamChunk> {
    this.ctx.emit('cache/hit', { key: row.key, ts: Date.now(), source })
    this.db.prepare('UPDATE llm_cache SET hit_count = hit_count + 1 WHERE key = ?').run(row.key)
    const chunks = JSON.parse(row.chunks) as StreamChunk[]
    // oxlint-disable-next-line typescript/require-await -- materialized chunks; preserves the AsyncIterable contract
    return (async function* replay(): AsyncGenerator<StreamChunk> {
      for (const chunk of chunks) yield chunk
    })()
  }

  /**
   * Best stored row by cosine similarity against the request embedding, provided it
   * clears `semanticThreshold`; `undefined` when nothing qualifies.
   */
  private bestSemanticMatch(requestEmbedding: number[]): CacheRow | undefined {
    const rows = this.db.prepare(
      'SELECT key, source, chunks, embedding, hit_count FROM llm_cache WHERE embedding IS NOT NULL',
    ).all() as unknown as CacheRow[]
    let best: CacheRow | undefined
    let bestScore = -1
    for (const row of rows) {
      const stored = JSON.parse(row.embedding as string) as number[]
      const score = cosineSimilarity(requestEmbedding, stored)
      if (score > bestScore) {
        bestScore = score
        best = row
      }
    }
    return best !== undefined && bestScore >= this.semanticThreshold ? best : undefined
  }

  /**
   * Wrap the miss path: forward every chunk, collect it, and store the row only when
   * the stream completes successfully. A thrown stream re-throws without storing;
   * early consumer abort (break) also skips storage because the generator terminates
   * at the yield point before reaching the store.
   */
  private capture(
    key: string,
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncIterable<StreamChunk> {
    const store = (chunks: StreamChunk[]): void => {
      this.store(key, options, chunks)
    }
    return (async function* wrapped(): AsyncGenerator<StreamChunk> {
      const chunks: StreamChunk[] = []
      try {
        const source = next()
        for await (const chunk of source) {
          chunks.push(chunk)
          yield chunk
        }
      } catch (error) {
        throw error
      }
      store(chunks)
    })()
  }

  /** Persist one completed response. Embeddings are computed only when the semantic tier is on. */
  private store(key: string, options: GenerateOptions, chunks: StreamChunk[]): void {
    const embedding = this.semantic ? JSON.stringify(this.embedder(options.messages)) : null
    this.db.prepare(
      'INSERT INTO llm_cache (key, source, chunks, embedding, hit_count, ts) VALUES (?, ?, ?, ?, 0, ?)',
    ).run(key, 'exact', JSON.stringify(chunks), embedding, Date.now())
  }
}

export default LlmCache

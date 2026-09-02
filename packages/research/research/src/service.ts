/**
 * External research seam (`ctx.research`): social-post search through the
 * `xurl` CLI and paper search/fetch through the arXiv Atom API, behind one
 * service with per-source counters. Both seams are additive and read-only —
 * the service never writes to the session, the KV cache, or any registry.
 *
 * The service is passive by default: with `enabled: false` it still registers
 * as `ctx.research`, but every lookup returns an empty result without
 * invoking the xurl CLI or the network. A missing xurl binary (execFile
 * `ENOENT`) degrades `searchPosts` the same way.
 *
 * @module @atlasai/atsh-research/service
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  ResearchConfig,
  ResearchPaper,
  ResearchPost,
  ResearchStats,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    research: ResearchService
  }
}

const execFileAsync = promisify(execFile)

/** Narrow an unknown value to a string when it is one. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Narrow an unknown value to a finite number (numeric strings accepted). */
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** Narrow an unknown value to a plain record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Map one xurl JSON item into a `ResearchPost`. Several common field
 * spellings are tolerated because the xurl stdout contract varies by build;
 * the post id and text are required, everything else degrades to a safe
 * fallback.
 */
function toResearchPost(item: unknown): ResearchPost | undefined {
  const rec = asRecord(item)
  if (rec === undefined) return undefined
  const id = asString(rec.id) ?? asString(rec.post_id) ?? asString(rec.tweet_id)
  const text = asString(rec.text) ?? asString(rec.full_text) ?? asString(rec.content)
  if (id === undefined || text === undefined) return undefined
  const authorRec = asRecord(rec.author)
  const displayName = asString(authorRec?.name)
  const metricsRec = asRecord(rec.metrics)
  return {
    id,
    text,
    author: {
      id: asString(authorRec?.id) ?? asString(rec.author_id) ?? asString(rec.user_id) ?? id,
      username: asString(authorRec?.username) ?? asString(rec.username) ?? 'unknown',
      ...(displayName !== undefined ? { name: displayName } : {}),
    },
    createdAt: asString(rec.createdAt) ?? asString(rec.created_at) ?? asString(rec.timestamp) ?? '',
    metrics: {
      likeCount: asNumber(metricsRec?.likeCount) ?? asNumber(rec.like_count) ?? 0,
      repostCount: asNumber(metricsRec?.repostCount) ?? asNumber(rec.repost_count) ?? 0,
      replyCount: asNumber(metricsRec?.replyCount) ?? asNumber(rec.reply_count) ?? 0,
    },
  }
}

/** Map parsed xurl JSON stdout (an array or `{ posts: [...] }`) to posts. */
function toResearchPosts(parsed: unknown): ResearchPost[] {
  const items = Array.isArray(parsed) ? parsed : asRecord(parsed)?.posts
  if (!Array.isArray(items)) return []
  const posts: ResearchPost[] = []
  for (const item of items) {
    const post = toResearchPost(item)
    if (post !== undefined) posts.push(post)
  }
  return posts
}

/** Extract the text content of the first `<tag>` element in a block. */
function extractElementText(xml: string, tag: string): string | undefined {
  const open = new RegExp(`<${tag}[^>]*>`).exec(xml)
  if (open === null) return undefined
  const start = open.index + open[0].length
  const end = xml.indexOf(`</${tag}>`, start)
  return end === -1 ? undefined : xml.slice(start, end)
}

/** Extract the text content of every `<tag>` element in a block, in order. */
function extractAllElementText(xml: string, tag: string): string[] {
  const values: string[] = []
  const open = new RegExp(`<${tag}[^>]*>`, 'g')
  let match: RegExpExecArray | null
  while ((match = open.exec(xml)) !== null) {
    const start = match.index + match[0].length
    const end = xml.indexOf(`</${tag}>`, start)
    if (end === -1) continue
    values.push(xml.slice(start, end))
  }
  return values
}

/** Collect every `<category term="...">` attribute value in a block, in order. */
function extractCategoryTerms(xml: string): string[] {
  const terms: string[] = []
  const category = /<category\b[^>]*\bterm="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = category.exec(xml)) !== null) {
    const term = match[1]
    if (term !== undefined) terms.push(term)
  }
  return terms
}

/** Extract every `<entry>` block from an Atom document (entries do not nest). */
function extractEntryBlocks(xml: string): string[] {
  const blocks: string[] = []
  const openTag = '<entry'
  const closeTag = '</entry>'
  let cursor = 0
  while (cursor < xml.length) {
    const start = xml.indexOf(openTag, cursor)
    if (start === -1) break
    const end = xml.indexOf(closeTag, start)
    if (end === -1) break
    blocks.push(xml.slice(start, end + closeTag.length))
    cursor = end + closeTag.length
  }
  return blocks
}

/** Parse one `<entry>` block into a `ResearchPaper`, or `undefined` when a required field is absent. */
function parseEntry(entry: string): ResearchPaper | undefined {
  const title = extractElementText(entry, 'title')
  const rawId = extractElementText(entry, 'id')
  const summary = extractElementText(entry, 'summary')
  if (title === undefined || rawId === undefined || summary === undefined) return undefined
  const id = rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, '')
  const published = extractElementText(entry, 'published')
  return {
    id,
    title: title.trim(),
    summary: summary.trim(),
    authors: extractAllElementText(entry, 'name'),
    published: published === undefined ? '' : published.slice(0, 10),
    categories: extractCategoryTerms(entry),
    pdfUrl: `https://arxiv.org/pdf/${id}`,
  }
}

/** Parse an Atom feed document into `ResearchPaper` records (string extraction only). */
function parseAtomFeed(xml: string): ResearchPaper[] {
  const papers: ResearchPaper[] = []
  for (const entry of extractEntryBlocks(xml)) {
    const paper = parseEntry(entry)
    if (paper !== undefined) papers.push(paper)
  }
  return papers
}

/** True when an execFile rejection means the binary is missing. */
function isENOENT(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}

/**
 * External research service. Load as a plugin (`ctx.plugin(ResearchService,
 * config)`); it registers as `ctx.research` (one per context — loading a
 * second throws, cordis' standard duplicate-service behavior). The service is
 * stateless apart from the in-memory counters returned by `getStats()`, so it
 * owns no resources to dispose.
 */
export class ResearchService extends Service {
  static Config = z.object({
    enabled: z.boolean().default(true),
    xurlBin: z.string().default('xurl'),
    arxivBaseUrl: z.string().default('https://export.arxiv.org/api/query'),
    maxResults: z.number().default(10),
    fetchTimeoutMs: z.number().default(20000),
  })

  private readonly enabled: boolean

  private readonly xurlBin: string

  private readonly arxivBaseUrl: string

  private readonly maxResults: number

  private readonly fetchTimeoutMs: number

  private stats: ResearchStats = { postsSearched: 0, papersSearched: 0, papersFetched: 0, failures: 0 }

  constructor(ctx: Context, config: ResearchConfig) {
    super(ctx, 'research')
    this.enabled = config.enabled ?? true
    this.xurlBin = config.xurlBin ?? 'xurl'
    this.arxivBaseUrl = config.arxivBaseUrl ?? 'https://export.arxiv.org/api/query'
    this.maxResults = config.maxResults ?? 10
    this.fetchTimeoutMs = config.fetchTimeoutMs ?? 20000
    this.ctx.effect(() => () => {
      // Stateless seam: the service owns no external resources, so disposal
      // is a no-op kept for the standard registrations-are-effects pattern.
    }, 'dsh-research: no owned resources to dispose')
  }

  /**
   * Search social posts through the `xurl` CLI.
   * @param query - the search query.
   * @param options - optional result cap; defaults to the config `maxResults`.
   * @returns the mapped posts; `[]` when disabled, the xurl binary is missing
   * (ENOENT), or the lookup fails (failures are counted in `getStats()`).
   */
  async searchPosts(query: string, options: { limit?: number } = {}): Promise<ResearchPost[]> {
    if (!this.enabled) return []
    const limit = options.limit ?? this.maxResults
    try {
      const { stdout } = await execFileAsync(this.xurlBin, ['search', query, '-n', String(limit)])
      let parsed: unknown
      try {
        parsed = JSON.parse(stdout)
      } catch {
        throw new Error('xurl search: stdout is not valid JSON')
      }
      const posts = toResearchPosts(parsed)
      this.stats.postsSearched += 1
      this.ctx.emit('research/posts-searched', { query, count: posts.length })
      return posts
    } catch (error) {
      if (isENOENT(error)) return []
      this.stats.failures += 1
      return []
    }
  }

  /**
   * Search arXiv papers through the Atom API.
   * @param query - the search query (sent as `all:<query>`).
   * @param options - optional result cap; defaults to the config `maxResults`.
   * @returns the parsed papers; `[]` when disabled or the lookup fails
   * (failures are counted in `getStats()`).
   */
  async searchPapers(query: string, options: { maxResults?: number } = {}): Promise<ResearchPaper[]> {
    if (!this.enabled) return []
    const maxResults = options.maxResults ?? this.maxResults
    const url = `${this.arxivBaseUrl}?search_query=all:${encodeURIComponent(query)}&max_results=${maxResults}`
    try {
      const xml = await this.fetchXml(url)
      const papers = parseAtomFeed(xml)
      this.stats.papersSearched += 1
      this.ctx.emit('research/papers-searched', { query, count: papers.length })
      return papers
    } catch {
      this.stats.failures += 1
      return []
    }
  }

  /**
   * Fetch one arXiv paper by id through the Atom API.
   * @param id - the arXiv id (with or without the `https://arxiv.org/abs/` prefix).
   * @returns the parsed paper, or `null` when disabled, not found, or the lookup fails.
   */
  async fetchPaper(id: string): Promise<ResearchPaper | null> {
    if (!this.enabled) return null
    const url = `${this.arxivBaseUrl}?id_list=${encodeURIComponent(id)}`
    try {
      const xml = await this.fetchXml(url)
      const papers = parseAtomFeed(xml)
      if (papers.length === 0) return null
      this.stats.papersFetched += 1
      return papers[0] ?? null
    } catch {
      this.stats.failures += 1
      return null
    }
  }

  /**
   * Snapshot of the per-source counters.
   * @returns the current research stats.
   */
  getStats(): ResearchStats {
    return { ...this.stats }
  }

  /** Fetch one Atom document with an abort deadline. */
  private async fetchXml(url: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, this.fetchTimeoutMs)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`arxiv fetch failed: HTTP ${response.status}`)
      return await response.text()
    } finally {
      clearTimeout(timer)
    }
  }
}

export default ResearchService

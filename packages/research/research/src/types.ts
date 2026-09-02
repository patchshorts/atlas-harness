/**
 * Canonical types for `@atlasai/atsh-research`: the research
 * configuration, the post/paper vocabulary, the discriminated
 * `ResearchResult` shapes, and the stats snapshot. Types only — no runtime
 * code.
 * @module @atlasai/atsh-research/types
 */

/** Configuration for the {@link ResearchService} service. */
export interface ResearchConfig {
  /**
   * Whether external lookups are allowed. Defaults to `true`; with `false`
   * the service still registers as `ctx.research` but every lookup returns
   * an empty result without invoking the xurl CLI or the network.
   */
  enabled?: boolean
  /** The xurl CLI binary used by {@link ResearchService.searchPosts}. Defaults to `'xurl'` (PATH lookup). */
  xurlBin?: string
  /** arXiv Atom API endpoint used by paper searches and fetches. Defaults to `'https://export.arxiv.org/api/query'`. */
  arxivBaseUrl?: string
  /** Default result cap for `searchPosts` / `searchPapers` when the caller omits the option. Defaults to `10`. */
  maxResults?: number
  /** Abort deadline (ms) for each arXiv HTTP request. Defaults to `20000`. */
  fetchTimeoutMs?: number
}

/** One social post returned by {@link ResearchService.searchPosts}. */
export interface ResearchPost {
  /** Stable post id as reported by the source. */
  id: string
  /** Post body text. */
  text: string
  /** The posting account. */
  author: {
    /** Account id. */
    id: string
    /** Account username (handle). */
    username: string
    /** Optional display name. */
    name?: string
  }
  /** Source-reported creation timestamp (string form, source-dependent). */
  createdAt: string
  /** Engagement counters when the source reports them. */
  metrics?: {
    /** Like count. */
    likeCount: number
    /** Repost/retweet count. */
    repostCount: number
    /** Reply count. */
    replyCount: number
  }
}

/** One arXiv paper returned by {@link ResearchService.searchPapers} / {@link ResearchService.fetchPaper}. */
export interface ResearchPaper {
  /** arXiv id with the `https://arxiv.org/abs/` prefix stripped. */
  id: string
  /** Paper title. */
  title: string
  /** Paper summary (abstract). */
  summary: string
  /** Author names, in feed order. */
  authors: string[]
  /** Publication date, `YYYY-MM-DD`. */
  published: string
  /** Category terms, in feed order. */
  categories: string[]
  /** Absolute PDF URL. */
  pdfUrl: string
}

/** Discriminated result of one research lookup, keyed by source kind. */
export type ResearchResult =
  | {
    /** Social-post result. */
    kind: 'posts'
    /** Matching posts. */
    posts: ResearchPost[]
    /** The query that produced the result. */
    query: string
    /** Number of returned posts. */
    count: number
  }
  | {
    /** Paper result. */
    kind: 'papers'
    /** Matching papers. */
    papers: ResearchPaper[]
    /** The query that produced the result. */
    query: string
    /** Number of returned papers. */
    count: number
  }

/** Snapshot of the research service's per-source counters. */
export interface ResearchStats {
  /** Successful `searchPosts` calls. */
  postsSearched: number
  /** Successful `searchPapers` calls. */
  papersSearched: number
  /** Successful `fetchPaper` calls. */
  papersFetched: number
  /** Failed lookups (fetch/parse errors; disabled lookups and missing xurl binaries are silent). */
  failures: number
}

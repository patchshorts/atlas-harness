/**
 * External research seam (`ctx.research`): social-post search through the
 * `xurl` CLI and paper search/fetch through the arXiv Atom API behind one
 * service, with per-source counters and typed `research/posts-searched` /
 * `research/papers-searched` events. Companion model-facing tools live in
 * `@atlasai/atsh-tool-research`.
 * @module @atlasai/atsh-research
 */

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A social-post search succeeded and returned `count` posts.
     * @param payload.query - the query that produced the result.
     * @param payload.count - number of returned posts.
     * @mode emit
     */
    'research/posts-searched'(payload: { query: string; count: number }): void
    /**
     * A paper search succeeded and returned `count` papers.
     * @param payload.query - the query that produced the result.
     * @param payload.count - number of returned papers.
     * @mode emit
     */
    'research/papers-searched'(payload: { query: string; count: number }): void
  }
}

export { default, ResearchService } from './service.ts'
export type {
  ResearchConfig,
  ResearchPaper,
  ResearchPost,
  ResearchResult,
  ResearchStats,
} from './types.ts'

/**
 * Model-facing research tools over the `ctx.research` seam: `xurl_search`
 * searches social posts through the xurl CLI and `arxiv_search` queries the
 * arXiv Atom API. Mount alongside `@atlasai/atsh-research` (or any backend
 * that registers `ctx.research`); the plugin loads only while both `tools` and
 * `research` are composed. Named exports preserve loader injection metadata.
 * @module @atlasai/atsh-tool-research
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@atlasai/atsh-tools'
// Type-only: resolves ctx.research (the dsh-research declaration augmentation)
// for the tool bodies and brings the seam's record types into scope. Elided at
// runtime.
import type { ResearchPaper, ResearchPost } from '@atlasai/atsh-research'

export const name = 'tool-research'
export const inject = ['tools', 'research']

/** Model-facing research tool configuration (none today; kept for the loader export shape). */
export interface Config {}

/** Schemastery configuration for the research tool plugin. */
export const Config: z<Config> = z.object({})

/**
 * Register `xurl_search` and `arxiv_search` on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and the research service.
 * @param _config - validated plugin config (unused; no options today).
 */
export function apply(ctx: Context, _config: Config): void {
  ctx.tools.register(defineTool({
    name: 'xurl_search',
    description: 'Search social-media posts (X/Twitter and compatible sources) for a query. '
      + 'Use it to surface public conversation around a topic before forming an opinion. '
      + 'Returns matching posts with their authors and engagement metrics.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'The search query — keywords or a phrase to match in post text.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of posts to return (defaults to the service maxResults).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          posts: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                text: { type: 'string', required: true },
                author: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    username: { type: 'string', required: true },
                    name: { type: 'string' },
                  },
                },
                createdAt: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.posts.length} posts found for the query.` }],
    },
    async execute(args: { query: string; limit?: number }): Promise<{ posts: ResearchPost[] }> {
      const posts = await ctx.research.searchPosts(
        args.query,
        args.limit !== undefined ? { limit: args.limit } : {},
      )
      return { posts }
    },
    presentCall: args => ({ card: 'generic', title: 'Search posts', kind: 'other', rawInput: args.query }),
  }))

  ctx.tools.register(defineTool({
    name: 'arxiv_search',
    description: 'Search arXiv papers for a query. '
      + 'Use it to find academic papers relevant to a topic. '
      + 'Returns matching papers with their authors, publication dates, categories, and PDF links.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'The search query — keywords or a phrase to match in paper titles, abstracts, and metadata.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of papers to return (defaults to the service maxResults).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          papers: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                authors: { type: 'array', items: { type: 'string' } },
                published: { type: 'string' },
                pdfUrl: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.papers.length} papers found for the query.` }],
    },
    async execute(args: { query: string; maxResults?: number }): Promise<{ papers: ResearchPaper[] }> {
      const papers = await ctx.research.searchPapers(
        args.query,
        args.maxResults !== undefined ? { maxResults: args.maxResults } : {},
      )
      return { papers }
    },
    presentCall: args => ({ card: 'generic', title: 'Search papers', kind: 'other', rawInput: args.query }),
  }))
}

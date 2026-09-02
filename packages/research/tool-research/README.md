# @atlasai/atsh-tool-research

English | [中文](README.zh.md)

Model-facing research tools over the `ctx.research` seam: `xurl_search` and
`arxiv_search`.

## What it adds

- `xurl_search` — search social-media posts for a query (required `query`,
  optional `limit`). Returns matching posts with authors and engagement
  metrics.
- `arxiv_search` — search arXiv papers for a query (required `query`,
  optional `maxResults`). Returns matching papers with authors, publication
  dates, categories, and PDF links.

## Mounting

Loads only while both `tools` and `research` are composed. Mount alongside
`@atlasai/atsh-research` (or any backend registering `ctx.research`):

```ts
await ctx.plugin(ResearchService, {})
await ctx.plugin(ToolResearchPlugin, {})
```

When the research service is disabled (`enabled: false`), the tools still
register but every call returns an empty result.

## Known Limitations and Deferred Work

- Results are returned verbatim — there is no deduplication or relevance
  ranking beyond the sources' own ordering.
- `xurl_search` depends on the `xurl` CLI being installed and on PATH (or on
  `xurlBin` being configured on the service).

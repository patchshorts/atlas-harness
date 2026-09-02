# @atlasai/atsh-research

English | [中文](README.zh.md)

External research seam for the DeepSeek Harness: a `ctx.research` service that
searches social posts through the `xurl` CLI and searches/fetches arXiv papers
through the Atom API. The companion `@atlasai/atsh-tool-research` package
exposes the model-facing `xurl_search` / `arxiv_search` tools.

## What it adds

- `ctx.research` — the `ResearchService` service. Load it as a plugin; it
  registers one service per context (loading a second throws, cordis' standard
  duplicate-service behavior).
- `searchPosts(query, { limit })` — runs `xurl search "<query>" -n <limit>`
  through the configured `xurlBin`, parses the JSON stdout, and maps the posts
  to `ResearchPost` records.
- `searchPapers(query, { maxResults })` — queries
  `${arxivBaseUrl}?search_query=all:<query>&max_results=<n>` and parses the
  Atom response with string extraction only (no XML dependency).
- `fetchPaper(id)` — fetches one paper by id list and returns the first entry,
  or `null` when not found.
- `getStats()` — per-source counters: `postsSearched`, `papersSearched`,
  `papersFetched`, and `failures`.
- Events: `research/posts-searched` and `research/papers-searched`, both
  `{ query, count }`, emitted after each successful search.
- Disabled-safe: with `enabled: false` (or a missing xurl binary, ENOENT)
  lookups return empty results without throwing and without touching the CLI
  or the network.

## Config (schemastery)

| key | type | default | meaning |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | allow lookups; with `false` the service still registers as `ctx.research` but every lookup short-circuits to an empty result |
| `xurlBin` | `string` | `'xurl'` | xurl CLI binary (PATH lookup unless absolute) |
| `arxivBaseUrl` | `string` | `'https://export.arxiv.org/api/query'` | arXiv Atom API endpoint |
| `maxResults` | `number` | `10` | default result cap when the caller omits the option |
| `fetchTimeoutMs` | `number` | `20000` | abort deadline per arXiv HTTP request |

## Usage

```ts
import { Context } from '@deepseek-ai/cordis'
import ResearchService from '@atlasai/atsh-research'

const ctx = new Context()
await ctx.plugin(ResearchService, {})
const posts = await ctx.research.searchPosts('attention is all you need', { limit: 5 })
const papers = await ctx.research.searchPapers('attention mechanisms', { maxResults: 3 })
ctx.research.getStats()   // → { postsSearched: 1, papersSearched: 1, papersFetched: 0, failures: 0 }
```

## Model experience

Lookups are READ-ONLY external queries: the service never writes to the
session, the KV cache, or any registry, so the prefix cache stays valid across
lookups. Output is bounded by `maxResults` / `limit` (default 10 records per
call), so per-call token cost is bounded by the returned records — results are
returned verbatim with no LLM summarization, ranking, or rewriting. No
deterministic input ever produces a different output: a disabled service (or a
missing xurl binary) degrades to an empty result instead of an error, keeping
the model-visible contract total.

## Known Limitations and Deferred Work

- The xurl stdout contract varies by build; the parser tolerates several
  common field spellings (array or `{ posts: [...] }`, `text`/`full_text`,
  `createdAt`/`created_at`, ...) but a specific build may still need a shim.
- Atom parsing is string-extraction only: XML entities are not decoded and
  malformed entries are dropped silently rather than reported.
- No pagination, no PDF full-text fetch, and no arXiv rate-limit management —
  callers pacing high-volume research are responsible for throttling.

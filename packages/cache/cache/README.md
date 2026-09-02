# @atlasai/atsh-cache

English | [中文](README.zh.md)

Deterministic + semantic LLM response cache for the DeepSeek Harness: a `ctx.llmCache`
service that intercepts the `llm/stream` Cordis waterfall, serves cached completions
without an upstream call, and stores completed responses on miss. The exact tier keys a
canonical sha256 over the model-visible request subset (`provider`, `model`, `purpose`,
`system`, `temperature`, `messages`, `tools`); the semantic tier (default off) replays a
stored completion whose embedding scores at or above `semanticThreshold` against the
request.

## What it adds

- `ctx.llmCache` — the `LlmCache` service. Load it as a plugin; it registers the
  `llm/stream` waterfall listener on the same context (one cache per context).
- Exact tier — a byte-identical request (same canonical hash) is replayed from the
  stored chunks and `next()` is never called: the caller receives the completion with
  **no upstream LLM hit**.
- Semantic tier — on an exact miss, the request embedding is compared (cosine) against
  every stored embedding; the best row at or above `semanticThreshold` is served as a
  near-match. Off by default because serving a near-match to a *different* prompt
  changes model-visible content.
- SQLite backend — rows land in the `llm_cache` table (Node's built-in `node:sqlite`;
  no npm dependency), closed when the owning fiber unloads.
- Public surface: `getStats()`, and a swappable `embedder` property for the semantic
  tier.
- Events: `cache/miss` (request forwarded upstream, emitted before the stream is
  consumed) and `cache/hit` (stored key + tier, `'exact'` or `'semantic'`).

## Usage

```ts
import { Context } from '@deepseek-ai/cordis'
import LlmCache from '@atlasai/atsh-cache'

const ctx = new Context()
await ctx.plugin(LlmCache, {})
```

With the cache mounted, every `ctx.llm.stream(...)` call on the same context is
intercepted. An identical second call is served from the cache:

```ts
ctx.llmCache.getStats() // → { entries, hits, misses, hitRate }
```

The handler only READS `options` — a deep-frozen loop-built request is never mutated —
and an upstream stream that throws stores nothing (the error re-throws untouched).

## Config (schemastery)

| key | type | default | meaning |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | intercept the `llm/stream` waterfall |
| `exact` | `boolean` | `true` | serve byte-identical requests from the cache |
| `semantic` | `boolean` | `false` | serve near-matches via the embedding tier |
| `semanticThreshold` | `number` | `0.9` | minimum cosine similarity for a semantic hit |
| `sqlite.path` | `string` | `':memory:'` | cache database file path |

Unknown config keys are rejected at load time (`CacheConfig: unknown key "..."`).

## Model experience

The cache replays a stored completion instead of calling the model, which changes token
flow: a hit produces **no upstream tokens** — the request never reaches the provider —
and the caller's token accounting sees only the replayed chunk stream. The backend log
is append-only: a hit adds NO new model-visible content (no messages, prompts, or
blocks), so the KV cache keyed by the request prefix stays valid across the replay — the
cache is prefix-cache-preserving by construction. A miss behaves exactly like an
unintercepted call, plus one stored row on success.

## Known Limitations and Deferred Work

- The semantic tier is default-off as a deliberate gate: serving a near-match to a
  different prompt changes model-visible content, so it must be explicitly opted into
  per deployment.
- The default embedder is a deterministic local bag-of-words model (fixed 256-dim
  count vector, L2-normalized) — not a real embedding model. Production deployments
  swap in one via the public `LlmCache.embedder` property; the swap is a runtime
  assignment, not a config key.
- The exact key covers a fixed request subset (`provider`, `model`, `purpose`,
  `system`, `temperature`, `messages`, `tools`); `maxTokens`, `stop`, and other
  generation knobs are not part of the key, so two requests differing only in those
  fields share one cache entry.
- No eviction, TTL, or per-key invalidation ships yet; the `llm_cache` table grows
  monotonically.
- Added additively to the frozen upstream clone: registers `ctx.llmCache`, appends the
  `cache/hit` / `cache/miss` events, and touches no existing package source.

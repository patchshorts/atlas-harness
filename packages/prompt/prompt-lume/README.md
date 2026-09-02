# @atlasai/atsh-prompt-lume

The L3 relevance-gated prompt assembly layer of the prompt-lume cost-reduction
system: selective prompt composition with a cache-core split and a
provenance-labeled task-aligned region.

## What it does

`PromptLumeService` listens on `system-prompt/assemble`. For a primed turn it:

1. Distills the working intent (the caller primes `ctx.promptLume.primeTurn({ intent, kind })`
   before assembling — the assemble event carries no turn text).
2. Retrieves the most-germane chunks through `ctx.promptCorpus.recall`.
3. Cross-encoder re-ranks them (`rerank`; provider-gated, recall-order fallback).
4. Byte-budget allocates to the most-germane corpora first (`skills` for tool
   turns, `agent-instructions` for workspace turns, `persona` for identity turns;
   `corpusPriority` config overrides).
5. Injects a provenance-labeled task-aligned region **after** the byte-stable core.

The stable core sections (harness identity, persona, capability grammar) are
never touched, so the provider prompt-cache read on the core survives across
turns. A chunk with no primed turn or an empty intent yields core only. Every
injected chunk carries a `[prompt-lume]` provenance line; retrieved corpus text
has `{{` template braces neutralized so `renderPrompt` never re-interprets them.

## Superseding agent-instructions truncate-to-fit

For instruction-bearing (workspace-kind) turns, prompt-lume is the primary
model-facing instruction route: it selects the germane chunks from the
`agent-instructions` corpus with a provenance line on each and a byte budget on
the assembled region. This replaces the old truncate-to-fit behavior — retain
only the relevant sections instead of truncating a whole-file render. The
`agent-instructions` package itself stays intact and additive; when prompt-lume
is disabled, the downstream path owns instruction content unchanged. Verified by
`tests/supersede.spec.ts`: a workspace turn yields provenance-labeled,
budget-honored selected chunks and drops a large non-germane section; the
byte-stable core stays identical across turns.

## Cost sidecar

Each assembly with a primed turn emits a `prompt-lume/cost` event carrying a
per-call record: heuristic core/region/input tokens (4 chars per token, the
harness density), cache-hit vs miss (the rendered core byte-identical to the
previous call), and the configured byte budget against the actual injected
region bytes. Cumulative totals are readable via `ctx.promptLume.costSummary()`
(calls, cache-hits/misses, total input/region tokens and region bytes), feeding
the corrections-per-session benchmark without requiring a listener to have
captured every event.

## Model, token, and KV-cache effects

- Reduces the system-prompt prefix that changes per turn to only the germane
  retrieved chunks; the byte-stable core is a cache-read candidate.
- Byte budget (`budgetBytes`) bounds the injected region's size per turn.
- Provenance labels every injected chunk; the stable core is never mutated.
- The cost sidecar surfaces the cache-read win: a cache-hit record means the
  provider prompt-cache read on the core survived that turn.

## Known Limitations and Deferred Work

- `recall()` does not surface the ingest-time `specificityRank`, so the budget
  allocator keys on the rerank score (the germane measure) rather than ingest
  specificity.

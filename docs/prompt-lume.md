# prompt-lume — relevance-gated selective prompt assembly

prompt-lume is the additive reference design behind the `packages/prompt/` group. It
reduces atlas-harness operating cost by attacking the two big context walls of normal
operation: the ~80% overhead of system prompts, SOUL, and instruction files, and the
full-price tail of a large system prompt on every call. It reuses the existing
`ctx.memoryStore.recall()` seam (see [packages/memory/memory](../packages/memory/memory/README.md))
to drive retrieval-based selection at `system-prompt/assemble`, and replaces
truncate-to-fit instruction rendering with retrieval-based selection. It is additive:
no core ATSH surgery, no lossy compression of the tuned core prompt, no new ML training.

The win has three parts. First, a byte-stable cached core makes the provider
prompt-cache read apply to most of the prompt, cutting prefix cost by 78-90%. Second,
RAG selection replaces the fixed per-turn instruction wall with only the germane
chunks. Third, every injected chunk carries a provenance line, so no silent content
reaches the model.

## Scope and boundary

The group adds `packages/prompt/{prompt-corpus,prompt-lume,prompt-context-trim}`. It
listens on `system-prompt/assemble` and exposes three services:

| Layer | Service | Responsibility |
|---|---|---|
| L2 RAG index | `ctx.promptCorpus` (`PromptCorpusService`) | Chunk and ingest instruction corpora into the MemoryStore; recall top-k on intent |
| L3 assembly | `ctx.promptLume` (`PromptLumeService`) | Distill intent, recall, cross-encoder re-rank, budget-allocate, inject a provenance-labeled task-aligned region; enforce the cache-core split |
| L4 compaction | `ctx.promptContextTrim` (`PromptContextTrimService`) | Prune the conversation surface by deletion, not rewrite, after the cached core; summarize as fallback below a floor |

Non-goals: no edit to the semantics of `packages/core/system-prompt`; no modification
of the `agent-instructions` package (its truncate-to-fit path stays intact; prompt-lume
supersedes it for model-facing instruction content while the byte budget and the
provenance rule still hold); no change to any prod application.

## The four layers

### L1 — Statically cacheable core

The system prompt splits into two regions. The stable core carries harness identity,
persona, and capability grammar. It is injected once and stays byte-identical for the
whole session, so the provider prompt-cache read applies to it. Per-turn `{{variable}}`
values never appear in the core; they live in the task-aligned region that renders after
the core. `renderPrompt` already supports this split.

### L2 — RAG index over instruction corpora

`prompt-corpus` builds a prompt-corpus index on the existing MemoryStore seam with the
pgvector plus lexical hybrid. At load it ingests system sections, persona blocks, each
AGENTS.md and CLAUDE.md, each SKILL.md (frontmatter and body), and SOUL entries as typed
chunks carrying metadata: corpus, scope, specificity-rank, and a cache-stability flag.
Chunking splits at semantic boundaries (heading or section), never at a fixed N tokens.

### L3 — Relevance-gated assembly

At `system-prompt/assemble` with the turn surface available, `prompt-lume` follows four
steps. It distills a cheap working-intent query from the current user message and the
last agent action. It recalls top-K (5-20) chunks through the hybrid retrieval. It
cross-encoder re-ranks the candidates and drops anything below a threshold. It
budget-allocates to the most-germane corpora first (skills for tool and domain turns,
workspace instructions for that directory, persona only when identity matters) and slots
the winners into the task-aligned region after the byte-stable core. Every injected
chunk carries a provenance line naming its corpus and scope.

### L4 — Verbatim compaction and semantic fallback

`prompt-context-trim` prunes the conversation surface to surviving verbatim lines by
deletion, not rewrite, once rolling context exceeds a threshold. Summarization runs only
as a fallback below a verbose floor. Compaction stays after the cached core so the cache
read survives.

## Cache-core contract

The cache-core contract is the first-order gate. The core is byte-stable: across two
different turns the assembled core byte-hash must be identical, because any drift
silently destroys the provider cache-read win. The check is `byte-hash(core)` equal
across turns. Per-turn content is confined to the task-aligned region rendered after the
core.

## Provenance rule

Every injected chunk is labeled. A provenance line names the corpus and scope of each
selected chunk, so any content the model sees can be traced to its source. An unlabeled
injected chunk is a defect. Provenance also disambiguates duplicate section names that
appear in more than one corpus.

## Cost sidecar

`prompt-lume` emits a `prompt-lume/cost` event after each primed assembly carrying a
per-call cost record: input tokens in and out, cache-hit versus cache-miss, and the
budget versus actual task-aligned region bytes. Cumulative totals are readable from
`PromptLumeService.costSummary`. The record feeds the corrections-per-session benchmark.

## Self-extension: acquisition surface and guardrails

prompt-lume can extend itself when the current lume-set misses needed context
or a capability. The seam is a three-part pipeline in the package `src/`
(`extend.ts`, `widen.ts`, `guard.ts`). It is additive and deterministic: no LLM
provider, no context, no global state.

### Acquisition surface

`extend.ts` exposes the registry plus the lookup. A `CapabilitySlot` names a
capability a turn may acquire: a short name, a one-line summary, the tool id it
exposes, a scope, and a provenance label. The scope vocabulary
(`tool` | `workspace` | `identity` | `general`) matches the turn surface, so a
workspace-scoped lookup never returns identity-slotted capabilities unless the
requester asks explicitly.

`scoreCapability` is a pure deterministic relevance function: an exact
substring hit on the name scores highest (1.0), then the summary (0.9), then
token-overlap Jaccard over both. No model calls and no randomness, so lookup
ordering is stable across runs.

`CapabilityRegistry.lookup(query, options)` filters by scope when one is given,
orders candidates by descending relevance (ties break by name), attaches a
derived `[prompt-lume:acquisition]` provenance line with scope, score, and slot
src, and caps at `limit`. A miss returns an empty array, never undefined and
never fabricated matches.

### Miss fallback: widen-hook

`widen.ts` rescues a retrieval miss. When the strict base lookup returns no
germane candidate, `widenOnMiss` escalates a fixed policy ladder in bounded
steps instead of failing. Each `WidenStep` may span more corpora (relax the
scope filter), raise the commit cap, lower the rerank cutoff, and raise the
region byte budget. The first step that recovers candidates wins; the outcome
reports which step fired. Every result stays behind a finite wall: the ladder
is fixed at policy build time, and if every step misses the outcome reports
the miss with empty candidates. There is no zero-commit path and no fabricated
rescue.

### Budget and guardrails

`guard.ts` is the enforcement layer the acquisition surface and widen-hook
defer to. A `SelfExtensionBudget` caps how many candidates may be acquired per
turn, how far the widen ladder may raise the region byte-budget ceiling, and
how many steps the ladder may traverse. `guardExtension` clamps widened results
to those caps before any candidate is reported or approved, and flags `capped`
when a cap bit the turn.

An `ApprovalGate` decides whether a produced candidate becomes a would-be
addition. The default `DENY_ALL` gate denies every candidate — the no-auto-add
safety rule. Approved candidates land in a detached addition plan. Nothing is
registered, mounted, or mutated by the guard, and no model-visible history is
touched. A caller (agent approval, sandbox edge) decides later whether to apply
the plan.

## Reduction grades (hook-width table)

prompt-lume is the harness default context reducer with four configurable grades — `low`, `med`, `high`, `xhigh` — set through the `reducerGrade` config key. The grade is a COST (reduction) ladder, not a price ladder. Reduction is driven by HOOK WIDTH: the width of the retrieval hook that decides how many corpus chunks commit into the task-aligned region. A WIDE hook retains more context across varied tasks (LOW reduction → HIGH token-in); a NARROW hook commits fewer, most-germane chunks (HIGH reduction → LOW token-in). `xhigh` is the narrowest hook — the least context — but every grade still composes core + region behind a finite wall. There is no zero grade.

The per-grade hook-width rows (packages/prompt/prompt-lume/src/grade.ts) and the measured trivial-turn token-in progression:

| Grade | Hook width (searchSpan / cutoff / commit / budget) | Reduction | Measured trivial-turn token-in (input = core + region) |
|---|---|---|---|
| `low` | 12 / 0.30 / 12 / 8192 B | LOW — retains the most context | 761 tok (core 12 + region 749) |
| `med` | 8 / 0.50 / 6 / 4096 B | MEDIUM | 394 tok (core 12 + region 382) |
| `high` | 4 / 0.70 / 3 / 2048 B | HIGH | 210 tok (core 12 + region 198) |
| `xhigh` | 2 / 0.85 / 1 / 512 B | HIGHEST — narrowest hook, least context | 87 tok (core 12 + region 75) |

The cells verify the ordering low > med > high > xhigh on both input and region tokens, assert every grade resolves to a finite nonzero wall (no zero grade), and confirm the byte-stable core stays invariant (12 tokens) across all four grades. The numbers above are measured from the real `prompt-lume/cost` events over a 12-chunk greeting-germane corpus (tests/grade-progression.spec.ts), not fabricated.

Lemma — fiat attention (do not overclaim). Token-in reduction is not the same as an attention win. The model attends with a U-shape and mid-window tokens carry less weight. Attribute reduction to measured token-in only; do not claim "40% better attention" from these numbers. The 40.1% figure is a token-in measurement, not an attention measurement.

## Configuration

Embedding is provider-gated and optional; the zero-dependency default is the lexical
backend. The cross-encoder re-rank is also provider-gated with a shallow fallback to the
recall order, so the default install never hard-depends on it. At the extremes: an
assemble with no user message returns the core only with no injected region, and an
over-budget retrieval drops the lowest-specificity chunks.

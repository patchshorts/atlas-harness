# @atlasai/atsh-prompt-context-trim

The L4 verbatim trimming layer of the prompt-lume cost-reduction system: trims
the rolling conversation surface by deletion-not-rewrite after the cached core
is fixed, so the provider prompt-cache read on the byte-stable core and the
surviving verbatim tail survives across turns. Summarization is a fallback
only when deletion cannot reach the byte budget (the verbatim floor alone
still exceeds it).

## Model experience

`trimSurface(surface, options)` deletes the oldest conversation lines until the
surviving suffix fits `thresholdBytes`, never rewriting a line and never
cutting below the `retainFloorBytes` verbatim floor. Outcomes:

- `none` — the surface is already within the threshold; nothing changed.
- `verbatim` — the oldest lines were deleted; the surviving tail is byte
  identical to the input (deletion, not rewrite), so a downstream provider
  caches the unchanged tail.
- `summarize` — even the minimal verbatim floor suffix exceeds the budget,
  so deletion cannot reach it; the caller must summarize the `pruned` head
  into a checkpoint while keeping the `retained` floor tail verbatim.

The service registers `ctx.promptContextTrim` with `enabled`,
`thresholdBytes` (default 32_000) and `retainFloorBytes` (default 8_000)
config.

## Key semantics

- **Deletion-not-rewrite.** Pruned lines are removed, never condensed in
  place; the surviving lines are the original objects with a measured byte
  size. Cache stability of the unchanged tail is preserved.
- **Floor-first.** The minimal floor suffix is computed first; if even that
  exceeds the budget the only honest answer is `summarize`, not a lossy
  verbatim cut.
- **Deterministic and pure.** `trimSurface` never mutates its input and is
  fully unit-tested (9 cases: within-threshold, over-threshold verbatim,
  floor honoring, under-floor summarize, empty surface, UTF-8 default
  measure, service wiring).

## Known Limitations and Deferred Work

- The summarizer itself is out of scope here: this package reports the
  `summarize` need; the caller (agent loop integration, not yet wired) owns
  the condensation call through the existing compaction seam.
- No `system-prompt/assemble` listener yet. This package provides the trim
  primitive; the assembly integration that runs it after the cached core is
  a later task.
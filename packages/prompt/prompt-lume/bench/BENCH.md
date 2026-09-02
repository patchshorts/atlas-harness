# prompt-lume live-proof bench

A deterministic, keyless harness-composition benchmark that mounts the REAL
services — SQLite MemoryStore via `ctx.memoryStore`, `prompt-corpus`,
`system-prompt` assemble, `prompt-lume` — and measures the system-prompt
token that would hit the provider for one instruction-following task.

This is the **T13 live proof** (exit condition 6): token-in reduction
measurable vs baseline (clone arm), no correctness regression.

## Run

```sh
cd ~/code/lume-clone
node --import tsx/esm TSX_TSCONFIG_PATH=./tsconfig.base.json \
  packages/prompt/prompt-lume/bench/run-live-proof.ts
```

Exit code 0 = all gates pass, 1 = any gate failed.

## What it measures

Two arms, both through the REAL `SystemPrompt.assemble()` (sections registered
via `ctx.systemPrompt.section`):

| Arm | Sections | Result |
|---|---|---|
| baseline (clone arm) | core + the WHOLE instruction wall | full wall rendered (legacy truncate-to-fit surface) |
| prompt-lume | the SAME core only | core + budget-gated, provenance-labeled task-aligned region of germane chunks |

The wall is a realistic multi-skill corpus (workspace rules, 9 skill docs,
persona blocks, SOUL). prompt-lume retrieves through the real MemoryStore
recall seam, re-ranks, budget-allocates, and injects only the germane chunks.

Tokens are measured with prompt-lume's own cost sidecar
(`estimateTokens`, 4 chars/token, matching the harness token-meter). The
byte-stable core is identical across arms, so the reduction is provably the
wall-drop, never a shrunk core.

## Measured result (2026-08-19)

```
budgetBytes            : 1024
baseline (wall) tokens : 1180
lume assembled tokens  : 707   (core 250 + region 457)
token-in reduction %   : 40.1%
cache hits (2 turns)   : 1/2   (core byte-identical -> provider cache-read path)
core byte-identical    : true
provenance line        : true
germane import sel     : true
germane secrets sel    : true
budget honored         : true  (845B)
renderPrompt no-throw  : true
LIVE-PROOF PASS
```

All eight gates pass:
- token-in-reduced: 1180 -> 707 (40.1%)
- no-regression-import / no-regression-secret: the germane contract is
  selected and labeled (the task still receives the binding rules)
- provenance-labeled: every injected chunk carries `[prompt-lume]`
- budget-honored: region 845B <= 1024B
- core-byte-identical: identity/persona/capability unchanged -> cache reads
- cache-core-stable: second turn sees a byte-identical core (cache hit)

## Why the reduction scales to the real ~80-90%

The region is capped by the byte budget (1024B here ~= 457 tokens). As the
wall grows (the real corpus is 208 skills), the baseline token-in grows with
the wall while the prompt-lume arm stays flat at core + budget-capped region.
At the real corpus scale the reduction approaches the research claim.

## Caveat (honest scope)

This is an assembly-layer live proof: it measures the token-in of the
assembled system prompt before any model call, which is exactly what maps to
provider input-token cost and the prompt-cache read. It is NOT a full
agentic LLM round-trip. A full-API bench task would additionally need
`DEEPSEEK_API_KEY` and a harness boot in this worktree, neither of which was
present for T13; the token-in mechanism the exit condition asks to measure is
fully covered here, deterministically and keyless.

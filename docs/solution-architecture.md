# Atlas Harness — Solution Architecture

**Document type:** solution architecture / program map.
**Date:** 2026-08-20 (full-picture recon per operator directive).
**Repo:** `https://github.com/patchshorts/atlas-harness` — branch `main` is the source of truth; feature branches per workstream.
**Model under test:** `deepseek/deepseek-v4-flash-0731` via OpenRouter, temperature 0, maxTokens 8192.

---

## 1. Purpose

Atlas is an additive-layer harness built on a vendored DeepSeek Harness (Cordis plugin spine). It tests one falsifiable claim on two independent axes, measured from an append-only event log:

1. **Corrections axis (quality)** — the additive capabilities reduce corrections-per-session against the vanilla clone at equal success.
2. **Token/cost axis (economics)** — a default context reducer (prompt-lume) cuts token-in monotonically by reduction grade, at a finite wall, never zero.

Anchoring invariant (**the golden rule**): *never mutate model-visible history.* Message history is a pure fold of the log; projections are deep-frozen; prefix caching is preserved (cached `$0.0033/M` vs uncached `$0.435/M` — a 120x gap).

---

## 2. Repository layout

```
vendor/      Vendored Cordis source (manifest + sync in vendor/README.md)
packages/    @atlasai/atsh-<pkg> workspaces
  core/        product API spine: session, system-prompt, tools, agent, agent-loop
  session/     durable session data; compaction; context-debt
  guard/       loop-hygiene + convergence + injection gates
  llm/         LLM capability, providers, cost ledger, routing
  prompt/      prompt-corpus, prompt-lume (context reducer), prompt-context-trim
  runtime-diagnostics/  events, alarms, verifiers
  skill/       skill-corpus (43-skill thesis-relevant subset)
  bench/       bench harness (run/cli, task_verify, tasks/ custom + reserve)
  bundle/      installable atsh --profile patch-layer bundles (headless, base)
  ...          full list in packages/README.md
docs/        architecture, paper/, solution-architecture.md (this file)
BENCHMARK.md running benchmarks
PROOF.md     self-targeted verification outputs
```

---

## 3. Program lineage — the workstreams that built it

Execution ran as workstreams; each completed one plan workstream (D1-D12 design decisions). Gauntlet-loop names in the second column are the loop-plan directory names from the build history.

| Workstream | Marker / branch | Capability | Design decision |
|-----|---------------|------------|-----------------|
| plan | `atlas-harness-plan-gauntlet` | Plan + fork architecture | — |
| create | `atlas-harness-create-gauntlet` | Create the fork, merge release | — |
| bench | `atlas-harness-bench-gauntlet` | Bench harness (clone vs additive) | — |
| paper | `atlas-harness-paper-gauntlet` | Initial paper (§1-§3) | — |
| chrome agent | `chrome-agent-atlas-harness-gauntlet` | Chrome agent CLI + CAPTCHA skill | — |
| golden rule | `atlas-redesign-golden-rule-gauntlet` | Golden rule as design invariant | umbrella |
| golden-rule enforcement | `ft/golden-rule-enforcement` | Frozen-projection + purity suite | **D1** |
| three-panel judge | `ft/three-panel-judge` | Unanimous 3-panel plan/completion gate | **D2** |
| context-debt compaction | `ft/context-debt-compaction` | Fold derives, never rewrites; positional placement | **D3** |
| token-budget routing | `ft/token-budget-routing` | Hard budget stop + workload-aware routing | **D4** |
| allowlist | `ft/allowlist` | Injection defense: channel marking + tool gate + taint | **D5** |
| observability | `ft/observability` | runtime-events/alarms/verifiers (P-Ratio, E→V deficit, repeated calls; TNR guard) | **D6/D7** |
| paper closeout | paper closeout workstream | Self-targeted verification + paper §3.5/3.6 (D1-D12 + acceptance table) | **D11** |
| capability routing | `ft/capability-routing` | ModelCapability registry, domain classifier, cheapest-capable selector | cap routing |
| prompt-lume | `ft/prompt-lume` (+ `-catalog`) | **prompt-lume**: cross-encoder rerank, byte-budget assembly, provenance region, cost sidecar | token axis |
| cost-reduction thesis | `main` | Cost-reduction thesis: prompt-lume as **DEFAULT**, grades `low/med/high/xhigh` hook widths, byte-stable core, record-exemption boundary | token axis |
| cost-reduction executor | cost-reduction loop executor | Cost-reduction loop executor | token axis |

**Design decisions D1-D12** recorded verbatim in `docs/paper/paper.md` §3.6 (folded from the paper-closeout workstream) and §3.5 record-exemption boundary (the cost-reduction workstream).

---

## 4. Core architecture (the invariant)

Two write sites only, both snapshot-then-freeze (`packages/core/session/src/index.ts`):
- constructor seed (restore mode, validate + freeze)
- `append()` (lossless JSON detach, `deepFreeze`, reentrancy guard, `seq = log.length`)

No other log write exists. `deriveMessages()` hands out a fresh array of *shared deep-frozen* messages; `foldSurface` replays purely and never touches the log. Full violation map: `RECON.md` (M1-M6, all CLOSED).

**Prefix caching:** the core renders byte-identical across turns, so the provider cache-read path is preserved. This is the economic foundation of the token axis.

---

## 5. The additive capability layer

Each capability is an additive package (new `ctx.*` registration, tool slot, preset slot, config rows) with *zero edits* to existing packages. Contract: 43-skill thesis-relevant corpus (normalized arms — no 200-skill content advantage), fresh session isolation.

### 5.1 Memory / recall — `prompt-corpus`
Semantic-boundary chunking (`chunker.ts`), typed chunks with corpus/scope/specificityRank/cacheStable, hybrid recall router, cross-encoder rerank that drops below-threshold results.

### 5.2 Context reducer — `prompt-lume` (the piecemeal context wall)
- Dists intent per turn → recall → rerank → **byte-budget allocate** (`allocateBudget` in `budget.ts`: sorts by corpus priority then rerank score, greedily accepts while cumulative bytes fit, drops the least-germane tail).
- Injects a provenance-labeled task-aligned region **after** the byte-stable core.
- **Grades** expose hook-width math: `low/med/high/xhigh` mapping `searchSpan / cutoff / commit / budget`.
  - Measured token-in (core 12 + region): **low 761 → med 394 → high 210 → xhigh 87** (monotone, never zero — "there is no zero grade").
- **Record-exemption boundary** (§3.5): may gate only non-record corpus slots (SKILL/instruction/persona/repo chunks), never the event history or pinned core.

### 5.3 Session context-debt — `session-context-debt`
Pure fold (`fold.ts`): detects stuffed spans, positionally places critical context at head/tail, `foldSummary` compresses non-essential log into a budget-bounded summary. Never rewrites the log (byte-identical through round-trip).

### 5.4 Convergence + hygiene — `loop-convergence`, `tool-task-verify`
- `agent/pre-step` guard returns `{kind:'reject'}` when the log shows an authoritative pass marker (`TASK_VERIFIED` / `CONTRACT OK`), stopping the loop on ground truth.
- `task_verify` runs the sandbox's authoritative verifier and isolates the done-signal.
- Transient-only retry (`EMPTY_RESPONSE` only).

### 5.5 Defense — injection gate
Channel-based instruction marking, tool-call allowlist at the boundary, taint verification. 19/22 empirical payloads resisted at the tool gate; all 12 directedTool payloads vetoed.

### 5.6 Observability + verifiers (A5)
`runtime-events` (typed stream, fold/replay, frozen projection), `runtime-alarms` (P-Ratio, E→V deficit, repeated calls), `runtime-verifiers` (TNR guard 0.25; passing-everything judge rejected; truth gate on bare ballots).

### 5.7 Routing
ModelCapability registry + deterministic task-domain classifier + cheapest-capable selector + `resolveRoute` overload. Mini RouterBench harness for deterministic route distribution.

---

## 6. Measured results (honest, corrected 2026-08-20)

Primary pre-registered n=64 escalation: clone `corr-n60-clone-20260820-1359` vs additive `corr-n60-add-20260820-1453`, same 64 tasks (34 core + 30 frozen reserve `rv-01..rv-30` at `ea0747a`).

| Metric | Clone | Additive | Verdict |
|---|---|---|---|
| Mean corrections/session | 0.609 | 0.297 | **−51%** ✓ |
| Corrections total | 39 | 19 | ✓ |
| Task success | 95.3% | 93.8% | 1-task regression (res-2-pydantic-v2) |
| Mean cost/session | $0.0336 | $0.0447 | +33% (no cost win) |
| Tool calls (total) | 724 | 1,020 | higher call volume |
| Per-call input tokens | 3,959 | 3,340 | smaller per call |
| Wilcoxon two-sided | — | **p = 0.112** | not significant |
| Wilcoxon one-sided (add<clone) | — | **p = 0.944** | rank on the additive-MORE tail |

**Honest verdict:** the additive layer lowers the *mean* correction count (−51%, concentrated on `hrd-01` −12) but the pre-registered signed-rank test does **not** confirm a directional benefit (rank split W+ 96.5 / W− 203.5; one-sided p=0.944, two-sided p=0.112). Per benchmark-spec §5 the claim is **falsified for this iteration**. Cost sidecar does not favor additive; the token-reduction claim (Section 4, `prompt-lume` grades) is the *separate* confirmed cost axis and does not require the corrections result.

**Token axis (independent):** prompt-lume grades cut token-in monotonically 761→87 across `low→xhigh` from real `prompt-lume/cost` events; core stays byte-stable (cache-read survives grade switches).

**Prior runs (all honest, preserved):** Iteration-2 p=0.047 = arm-fat artifact (200-skill corpus mismatch); normalized p=0.48 = falsification before tool fixes; recovery 34-task p=0.953 (low power); n=64 escalation p=0.112/0.944 (this study).

---

## 7. Branch & merge state (2026-08-20)

| Branch | State | Commit | Notes |
|---|---|---|---|
| `main` | canonical | — | Corrected paper + §3.6/3.7 + capability-routing merged; 43-skill corpus NOT yet applied |
| `ft/capability-routing` | MERGED to main | — | capability routing |
| `paper/correct-wilcoxon` | MERGED to main | — | honest Wilcoxon (p=0.112/0.944), corrected call totals |
| `fix/merge-features` | unmerged | — | **43-skill corpus trim** + paper §3.6/3.7; push blocked by typecheck |
| `bench/t9b-classify` | unmerged / DO NOT merge wholesale | — | holds the *competing* "Loop Harness" paper + the write path; would replace real paper + delete corpus wholesale |
| `ft/observability` | merged content (paper D1-D12 folded) | — | observability/verifiers already on main |

**Feature/code branches** (`ft/observability`, `ft/capability-routing`, prompt-lume, etc.) are genuine tested add-ons; they merge cleanly onto main. `bench/t9b-classify` must be reconciled surgically (take the **43-skill corpus trim**, not the competing paper).

---

## 8. Open items / pending work

1. **Land the 43-skill corpus trim on main** (operator: *"the 43 skills is the correct corpus"*). Already cherry-picked onto `fix/merge-features`; push currently blocked by a **typecheck failure in the capability-routing code**: `cost-capability.spec.ts` does not pass the required `domains` field to `ModelCapability` (TS2345/TS2741/TS2532). Fix that spec to satisfy the new `ModelCapability` shape, then merge `fix/merge-features` → main.
2. **Reconcile `bench/t9b-classify`** — never merge wholesale (competing paper + full-corpus deletion). Bring the 43-skill trim only.
3. **Confirm the paper's §3.6/3.7** (D1-D12 + acceptance table) landed and §4 is intact on main.
4. **Statistical follow-up** for the corrections axis: a larger/batch-of-effect suite or a power analysis that does not assume the hypothesized sign — the current n=64 does not confirm direction.
5. **Record-preservation gate** — verify it is committed and green after merges.

---

## 9. Key references

- `docs/paper/paper.md` — the paper (Additive Harness, two-axes framing, honest results).
- `docs/architecture.md`, `docs/prompt-lume.md` — subsystem contracts.
- `PROOF.md` — self-targeted verification outputs.
- `BENCHMARK.md`, `bench-manifest.json` — the 64-task suite + manifest.
- `bench-runs/` on the operator machine — n=64 run artifacts (`counts-*`, `cost-*`, `session-logs/`).
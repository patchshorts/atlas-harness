# Data Appendix

Companion to *"What Actually Moves: Five Measured Axes of an Additive Agent Harness."*

## Provenance

- **Clean paired run (this paper):** `corr-g244-run2-20260825071455`, executed 2026-08-25. Both arms ran the same 69-task manifest on the identical, patched harness. Clone arm first, additive arm second, same machine/model/day.
- Model: `deepseek/deepseek-v4-flash-0731` via OpenRouter, temperature 0, max tokens 8192.
- ATLAS arm: additive harness (`/home/cgodwin/code/atlas-harness`). Clone arm: unmodified DeepSeek Harness fork (`bench-clone @ 0b152c4`).
- The per-task table (section 8) is machine-generated from the `corr-g244-run2-20260825071455` run.log. Raw per-session session artifacts are retained for this run; every figure below matches the paper body exactly.
- **Discarded run (not used):** `corr-g244-run1-20260825043443`. Contaminated by a mid-run harness defect — a model solution with an infinite loop stalled its verify step for 3.7 hours at 99.9% CPU because `verify.sh` ran `pytest` unbounded. The fix (every `verify.sh` pytest invocation bounded by `timeout 120`) was applied to both arms, and the run was discarded and re-run clean. No number in this paper is drawn from the discarded run.

## 1. Pre-registered axes

| Axis | Prediction | Not confirmed if |
|:---|:---|:---|
| P1 Waste-ratio (primary) | Atlas < clone, per session | Effect confined to a tail; pooled direction absent |
| A1 Corrections | Atlas < clone, per session | CI on the paired delta includes zero |
| A2 Task success | Atlas >= clone - 5pp | McNemar shows a regression |
| A3 Cost | Atlas < clone, per session | Median ~ 0, or effect absent among tasks both finish |
| A4 Cache-hit rate | Atlas > clone | Measured hit rate is not higher |

## 2. Aggregate headline (both arms, 69 tasks)

| Measure | Clone | Atlas |
|:---|:---:|:---:|
| Success | 62/69 (89.9%) | 61/69 (88.4%) |
| Total corrections | 64 | 57 |
| Corrections / session | 0.928 | 0.826 |
| Mean waste-ratio / session | 0.253 | 0.248 |
| Pooled waste (wasted ÷ total calls) | 0.221 (166/750) | 0.230 (164/712) |
| Total cost | $2.05 | $1.67 |
| Mean cost / session | $0.0297 | $0.0242 |
| Mean cache-hit rate | 0.721 | 0.756 |
| Run exit code | 0 | 0 |

## 3. P1 — Waste-ratio (primary) spread

- Non-zero paired delta: **39 of 69 tasks** (22 Atlas-lower, 17 Atlas-higher, 30 ties).
- The effect is no longer confined to the contract-cliff tail (three tasks in the earlier 64-task run).
- Direction is mixed: the mean per-session favours Atlas (0.253 vs 0.248); pooled favours clone (0.221 vs 0.230). Report both; neither is the headline — the spread is.

## 4. A1 — Corrections (held as secondary)

- Total 64 (clone) vs 57 (Atlas); 0.928 vs 0.826 per session.
- Paired test does **not** confirm: 44/69 ties, 13 Atlas-fewer, 12 Atlas-more; exact Wilcoxon two-sided p = 0.47 (one-sided 0.24).
- By class: C1 4→2, C2 19→14, C3 41→41 (flat), C4 0→0, C5 0→0.
- Carried tasks: crit-2 4→0, ref-02 4→1, rv-31 5→3, hrd-01 2→0. Counter-example: mem-1 5→6.

## 5. A2 — Task success

- 62/69 vs 61/69. One discordant task: rv-30-zscore-contract (clone passes, Atlas fails). McNemar on one discordant pair is not signal.

## 6. A3 — Cost

- Mean $0.0242 (Atlas) vs $0.0297 (clone), -19%. Total $1.67 vs $2.05.
- Largest deltas favour Atlas (rv-30 $0.182→$0.091, rv-18 $0.076→$0.012, rv-28 $0.101→$0.046, rv-27 $0.116→$0.080).
- Counter-examples (Atlas more): dbg-09 $0.015→$0.045, rv-32 $0.038→$0.066, web-01 $0.065→$0.089.
- The mean advantage is broad (not a single-task artifact). Mechanism attribution (region placement vs bare additive count) is isolated in the §7A grade sweep, not inferred from this paired comparison.

## 7. A4 — Cache-hit rate

- Mean 0.721 (clone) vs 0.756 (Atlas), +3.5 points. Reverses the earlier 64-task run's direction (0.71 vs 0.74 favouring clone). This paired figure is context, not the mechanism verdict — the cache axis is resolved by the within-arm grade sweep in §7A, which isolates region placement and finds the named defect fails to reach the target.

## 7A. A5 — Reducer grade sweep (pooled cost claim)

Within-arm `reducerGrade` sweep (off/low/med/high/xhigh), additive arm only, 69 sessions per grade (37 custom + 32 reserve). All 5 grades folded, complete. Re-measured at report time.

Cost card (identical across grades and arms): uncached input $0.435/M tokens, cached input $0.0033/M tokens (≈132× cheaper), output $0.435/M tokens.

| Grade | n | Pooled cost ($) | Pooled cache-hit | Mean cache-hit | Median cache-hit | Success | Both-halves finished |
|---|---:|---:|---:|---:|---:|---:|---:|
| off | 69 | 2.1574 | 0.6772 | 0.6772 | 0.7604 | 58/69 | yes |
| low | 69 | 1.6636 | 0.7565 | 0.7565 | 0.8140 | 61/69 | yes |
| med | 69 | 1.4298 | 0.7684 | 0.7684 | 0.7906 | 61/69 | yes |
| high | 69 | 1.6235 | 0.7688 | 0.7688 | 0.8128 | 62/69 | yes |
| xhigh (goal) | 69 | 2.2766 | 0.6882 | 0.6882 | 0.6812 | 61/69 | yes |

Self-baseline: prior Atlas config pooled 0.804; target 0.882. No grade reaches 0.882; goal grade (xhigh) pooled 0.6882 is below self-baseline. Documented gap.

Off→med pooled cost reduction: 33.7% (point). Paired bootstrap over per-task cost, 10 000 resamples with fixed RNG seed 20260825, 95% CI: **[0.3%, 54.4%]**. Sign test on per-task delta: 43 tasks favour med, 25 favour off, 1 tie (one-sided p ≈ 0.02). The direction is robust; the magnitude is dominated by a small number of expensive tasks (rv-30, rv-27, hrd-02).

Grade selection is a multiple-comparison surface — 5 grades were tried, the best is featured. The three "reproducing" grades are correlated estimates on the same 69 tasks, not independent replications; the paired bootstrap above applies within a fixed grade choice. The sweep varies `reducerGrade` end to end, coupling region existence, hook width, and tail-message placement. The specifically-region-placement claim is inferred from the mechanism prediction rather than directly isolated by the sweep; a sibling `med-in-prefix` grade would separate placement from width and is not present here. The `off` self-baseline still runs the rest of the additive stack; it is not `clone`.

Computed from `gaf247-sweep-pooled.json` (canonical), per-grade `cost-additive.json` (per-session cacheHitRate + usd) joined with `counts-additive.json` (taskSuccess) in this repo's sweep run; retained at `/home/cgodwin/bench-runs/gaf247-sweep-*`.

## 8. Full per-task paired table (machine-generated, run2)

Columns: task, success (Y/N) per arm, waste-ratio per arm, corrections per arm, cost (USD) per arm. All sessions exited 0 (clean); none timed out.

| task | succ C | succ A | waste C | waste A | corr C | corr A | usd C | usd A |
|:---|---:|:---|---:|---:|---:|---:|---:|---:|
| coord-02-artifact-schema | Y | Y | 0.333 | 0.333 | 2 | 2 | 0.0124 | 0.0217 |
| coord-1-subtask-handoff | Y | Y | 0.333 | 0.333 | 1 | 1 | 0.0215 | 0.0207 |
| crit-03-todo-honesty | Y | Y | 0.143 | 0.143 | 1 | 0 | 0.0104 | 0.0104 |
| crit-1-plan-follow | Y | Y | 0.250 | 0.308 | 2 | 1 | 0.0231 | 0.0260 |
| crit-2-todo-contract | Y | Y | 0.364 | 0.000 | 4 | 0 | 0.0482 | 0.0223 |
| dbg-01-merge-offbyone | Y | Y | 0.333 | 0.400 | 0 | 1 | 0.0111 | 0.0108 |
| dbg-03-encoding-trap | Y | Y | 0.250 | 0.250 | 0 | 0 | 0.0295 | 0.0218 |
| dbg-04-timezone-trap | Y | Y | 0.286 | 0.286 | 0 | 1 | 0.0118 | 0.0204 |
| dbg-05-mutable-default | Y | Y | 0.333 | 0.286 | 1 | 2 | 0.0118 | 0.0117 |
| dbg-06-shadow-builtin | Y | Y | 0.286 | 0.286 | 2 | 1 | 0.0307 | 0.0114 |
| dbg-07-exception-contract | Y | Y | 0.400 | 0.400 | 1 | 0 | 0.0271 | 0.0102 |
| dbg-08-loop-step | Y | Y | 0.400 | 0.286 | 0 | 0 | 0.0104 | 0.0107 |
| dbg-09-parse-currency | Y | Y | 0.750 | 0.800 | 1 | 2 | 0.0146 | 0.0453 |
| dbg-10-cache-stale | Y | Y | 0.286 | 0.286 | 0 | 0 | 0.0302 | 0.0209 |
| fin-01-effective-rate | Y | Y | 0.364 | 0.300 | 0 | 0 | 0.0246 | 0.0239 |
| grn-01-state-machine | Y | Y | 0.333 | 0.250 | 1 | 1 | 0.0106 | 0.0116 |
| grn-02-quoted-csv | Y | Y | 0.286 | 0.200 | 1 | 0 | 0.0124 | 0.0188 |
| grn-03-token-bucket | Y | Y | 0.200 | 0.200 | 0 | 0 | 0.0114 | 0.0114 |
| hrd-01-iterative-repair | N | N | 0.333 | 0.182 | 2 | 0 | 0.0335 | 0.0388 |
| hrd-02-cross-turn-memory | N | N | 0.048 | 0.000 | 0 | 0 | 0.1719 | 0.1523 |
| hrd-03-plan-discipline | N | N | 0.000 | 0.000 | 0 | 0 | 0.0183 | 0.0287 |
| mail-01-superseded-figures | Y | Y | 0.087 | 0.091 | 0 | 0 | 0.0325 | 0.0305 |
| mem-06-precedence-trap | Y | Y | 0.100 | 0.100 | 0 | 0 | 0.0123 | 0.0123 |
| mem-07-shared-client | Y | Y | 0.125 | 0.333 | 0 | 1 | 0.0208 | 0.0117 |
| mem-1-config-drift | Y | Y | 0.429 | 0.500 | 5 | 6 | 0.0256 | 0.0247 |
| mem-2-convention-consistency | Y | Y | 0.154 | 0.133 | 0 | 0 | 0.0469 | 0.0241 |
| mem-3-state-recall | Y | Y | 0.200 | 0.200 | 0 | 0 | 0.0114 | 0.0208 |
| mem-4-parallel-fix | Y | Y | 0.000 | 0.000 | 0 | 0 | 0.0163 | 0.0178 |
| mem-5-dependency-matrix | Y | Y | 0.857 | 0.857 | 1 | 2 | 0.0125 | 0.0126 |
| ref-01-api-migration | Y | Y | 0.111 | 0.125 | 0 | 0 | 0.0286 | 0.0110 |
| ref-02-import-upgrade | Y | Y | 0.545 | 0.250 | 4 | 1 | 0.0136 | 0.0128 |
| ref-03-config-schema | Y | Y | 0.125 | 0.077 | 0 | 0 | 0.0117 | 0.0235 |
| res-03-schema-verify | Y | Y | 0.286 | 0.286 | 1 | 1 | 0.0210 | 0.0120 |
| res-1-arxiv-client | Y | Y | 0.400 | 0.214 | 1 | 0 | 0.0378 | 0.0276 |
| res-2-pydantic-v2 | Y | Y | 0.100 | 0.100 | 0 | 0 | 0.0236 | 0.0135 |
| rv-01-running-sum | Y | Y | 0.333 | 0.333 | 1 | 1 | 0.0193 | 0.0103 |
| rv-02-shadow-loop | Y | Y | 0.250 | 0.333 | 2 | 1 | 0.0209 | 0.0104 |
| rv-03-zero-guard | Y | Y | 0.250 | 0.250 | 1 | 1 | 0.0114 | 0.0115 |
| rv-04-mutable-default | Y | Y | 0.200 | 0.077 | 0 | 0 | 0.0100 | 0.0151 |
| rv-05-key-normalize | Y | Y | 0.167 | 0.167 | 0 | 0 | 0.0106 | 0.0104 |
| rv-06-lower-bound | Y | Y | 0.200 | 0.200 | 0 | 0 | 0.0105 | 0.0105 |
| rv-07-unique-order | Y | Y | 0.286 | 0.286 | 0 | 0 | 0.0206 | 0.0111 |
| rv-08-chunk | Y | Y | 0.286 | 0.250 | 0 | 0 | 0.0207 | 0.0285 |
| rv-09-merge-safe | Y | Y | 0.286 | 0.375 | 0 | 1 | 0.0201 | 0.0300 |
| rv-10-flatten | Y | Y | 0.286 | 0.286 | 0 | 0 | 0.0378 | 0.0115 |
| rv-11-rotate | Y | Y | 0.250 | 0.286 | 0 | 0 | 0.0248 | 0.0204 |
| rv-12-tally | Y | Y | 0.286 | 0.286 | 0 | 1 | 0.0107 | 0.0197 |
| rv-13-wrap-config | Y | Y | 0.200 | 0.182 | 1 | 1 | 0.0289 | 0.0219 |
| rv-14-tax-rate | Y | Y | 0.250 | 0.200 | 1 | 1 | 0.0209 | 0.0119 |
| rv-15-fee-helper | Y | Y | 0.222 | 0.250 | 1 | 1 | 0.0115 | 0.0109 |
| rv-16-mean-helper | Y | Y | 0.250 | 0.250 | 0 | 1 | 0.0114 | 0.0210 |
| rv-17-name-clean | Y | Y | 0.222 | 0.222 | 1 | 0 | 0.0482 | 0.0115 |
| rv-18-region-pick | Y | Y | 0.087 | 0.222 | 1 | 1 | 0.0758 | 0.0122 |
| rv-19-indent-depth | Y | Y | 0.222 | 0.222 | 1 | 1 | 0.0395 | 0.0217 |
| rv-20-window-size | Y | Y | 0.222 | 0.200 | 0 | 1 | 0.0214 | 0.0207 |
| rv-21-stale-dir | Y | Y | 0.222 | 0.200 | 0 | 0 | 0.0117 | 0.0117 |
| rv-22-stale-subdir | Y | Y | 0.250 | 0.250 | 0 | 0 | 0.0295 | 0.0209 |
| rv-23-stale-dir | Y | Y | 0.250 | 0.250 | 2 | 2 | 0.0127 | 0.0217 |
| rv-24-parent-path | Y | Y | 0.286 | 0.250 | 1 | 1 | 0.0115 | 0.0114 |
| rv-25-stale-dir | Y | Y | 0.250 | 0.222 | 1 | 1 | 0.0208 | 0.0296 |
| rv-26-stale-archive | Y | Y | 0.222 | 0.222 | 1 | 1 | 0.0217 | 0.0211 |
| rv-27-clamp-contract | Y | Y | 0.103 | 0.250 | 0 | 2 | 0.1163 | 0.0801 |
| rv-28-batches-contract | Y | Y | 0.086 | 0.094 | 3 | 2 | 0.1007 | 0.0458 |
| rv-29-parser-contract | Y | Y | 0.200 | 0.444 | 3 | 3 | 0.0386 | 0.0351 |
| rv-30-zscore-contract | Y | N | 0.085 | 0.471 | 2 | 2 | 0.1816 | 0.0910 |
| rv-31-revert-contract | N | N | 0.154 | 0.385 | 5 | 3 | 0.0308 | 0.0154 |
| rv-32-plan-reopen | N | N | 0.217 | 0.115 | 2 | 2 | 0.0381 | 0.0660 |
| trv-01-trivial-turn | N | N | 0.000 | 0.000 | 0 | 0 | 0.0084 | 0.0084 |
| web-01-token-contradiction | N | N | 0.529 | 0.278 | 3 | 3 | 0.0646 | 0.0889 |

## Provenance note

The discard-and-rerun is recorded because it changed what the numbers mean. The contaminated run's crit-1 session was a zero-call, near-zero-cost "failure" produced by a 3.7-hour stall, not a real completion; reusing it would have poisoned the cost and correction aggregates. The clean rerun records all 138 sessions under the identical patched harness with zero session errors. The timeout bound that fixed the harness is a permanent structural improvement: no model solution can freeze an arm again.

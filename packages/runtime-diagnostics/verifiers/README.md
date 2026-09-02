# dsh-runtime-verifiers

English | [中文](README.zh.md)

Hardened verifier correctness for DeepSeek Harness. Evaluates a verifier's judgment against a LABELED fixture battery — known-good and known-bad inputs — and rejects the passing-everything judge (D7 Fix 6/7). A verifier that accepts everything converts an untrusted exhaust into a false seal of correctness; the true-negative-rate guard catches it, and the truth gate rejects bare `pass` ballots that carry no evidence.

## Design posture

The golden rule holds: evaluation is a pure fold over the verifier's ballots. The module never mutates the verifier, the fixtures, a ballot, or any event, and never writes model-visible history. The returned report is a fresh projection.

## API

| Symbol | Purpose |
|---|---|
| `evaluateVerifier(verifier, fixtures, opts)` | Run a verifier over labeled fixtures; returns a `VerifierReport` (verdict pass/fail/unvalidated + confusion-matrix counts + true-negative rate). |
| `truthGate(ballot, opts)` | Gate one ballot: a `pass` must carry evidence ≥ `minEvidenceChars`. |
| `isFalsePositive(fixture, ballot)` | Strict check: a `pass` on a labeled NEGATIVE is the all-pass debt. |
| `UNVALIDATED` | Report when the battery carries no negative fixture (guard cannot run). |

Defaults: `MIN_TRUE_NEGATIVE_RATE = 0.25`, `MIN_EVIDENCE_CHARS = 1`.

- The TNR guard: when labeled negatives exist and the rejection rate falls below `minTrueNegativeRate`, the verifier is rejected as all-pass debt. A battery with no negatives yields `unvalidated` (callers must supply negatives).
- Replan is counted as a rejection (never a pass), matching the three-panel contract: a single NO returns a replan, not a pass.

## Development

Self-targeted tests (vitest) in `tests/`. The negative-fixture suite carries ≥5 distinct NEGATIVE fixtures per verifier plus an all-passer rejection case (D7). No full-bench requirement (D11 directive). Additive package: no production deploy, no rollback escape hatch — revert = directory removal.

## Model Experience

None, as the verifier evaluation is a pure fold over labeled fixtures that never alters prompts, messages, or tool results.

#### KV Cache effect

None; the verifier evaluation assembles no provider request.

## Known Limitations and Deferred Work

- T-detection is categorical, not calibrated: a verifier that produces, e.g., exactly 26% TNR near the floor is accepted; only a collapse below the floor fails. Calibrating a graded/confidence scale is a future enhancement.
- The guard measures a discrete fixture battery. Online/streaming TNR adaptation (re-measuring against newly observed negatives) is not yet implemented.

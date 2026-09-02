# dsh-runtime-alarms

English | [中文](README.zh.md)

Alarm detectors that fold over the DeepSeek Harness runtime event stream and return derived signals: P-Ratio efficiency collapse, evidence-to-verdict deficit, and repeated-call loops. Detectors are pure — they read the replayable event projection and never mutate the stream or model-visible history (golden rule).

## Design posture

The golden rule holds: detectors are diagnostic projections. They fold over the event stream (`@atlasai/atsh-runtime-events`) once per pass and return alarm objects. No detector writes the stream, mutates an event, or touches message history. The monotonic `seq` cursor in the underlying stream already prevents double-consume; each detector is additionally single-pass so an event is never counted twice within one fold.

## Detectors

| Detector | Condition | Options |
|---|---|---|
| `detectPRatio` | output/(input+output) below `minOutputFraction` (default 0.15) across the model-call window | `minOutputFraction` |
| `detectEvidenceDeficit` | a judge vote carries evidence shorter than `minEvidenceChars` (default 1) | `minEvidenceChars` |
| `detectRepeatedCalls` | the same tool called `repeatThreshold` (default 3) times in a run | `repeatThreshold`, `strictConsecutive` |

`detectAlarms(events, opts)` runs all three in stable order and returns every alarm as a fresh projection of the inputs.

## Development

Self-targeted tests (vitest) in `tests/`. Behavior is exercised with synthetic streams that are deterministic; no full-bench requirement (D11 directive). No-production-deploy, no-rollback-escape-hatch posture matches the parent plan the prior workstream (change is additive; revert = directory removal).

## Model Experience

None, as the alarm detectors are diagnostic folds that never alter prompts, messages, schemas, streams, or tool results.

#### KV Cache effect

None; the detectors assemble no provider request.

## Known Limitations and Deferred Work

- Detectors are synchronous single-pass folds. A persistent/streaming detector that emits alarms incrementally as events land is a future enhancement; the current shape fits the replayable in-memory fold of the event package.
- Thresholds are static per call; runtime-adaptive thresholds are not yet implemented.

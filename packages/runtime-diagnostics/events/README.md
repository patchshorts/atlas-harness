# dsh-runtime-events

English | [中文](README.zh.md)

Typed, replayable diagnostic event stream for DeepSeek Harness runtime signals: tool calls, model calls, judge votes, budget state, and compaction. Alarms (P-Ratio, E→V deficit, repeated-call) and verifiers consume the replayable fold of this stream to make proven operation decisions.

## Design posture

The golden rule holds: this stream is a diagnostic PROJECTION derived from the log by a pure function fold. It never mutates model-visible history; deep-frozen projections throw on mutation. The stream is append-only within a session fold.

## Development

Self-targeted tests (vitest) in `tests/`. No full-bench requirement: event and alarm behaviors are exercised with synthetic streams that are deterministic.

## Model Experience

None, as the event stream is a diagnostic projection that never alters prompts, messages, schemas, streams, or tool results.

#### KV Cache effect

None; the event stream assembles no provider request.

## Known Limitations and Deferred Work

- Durable persistence of the event stream is not yet required by any consumer; the replay fold covers the read path in memory. Resurface at the next consumer demand.
- Typed event kinds and the append-only replayable stream core are implemented in `src/types.ts` + `src/stream.ts` (append, snapshot, freeze, pure fold, replay). Alarm detectors and hardened verifiers live in sibling packages of this diagnostic group.

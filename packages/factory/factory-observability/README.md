# @atlasai/atsh-factory-observability

Fix 3/6/7 observability + verifier correctness (`ctx.observability`): every
step is logged as a structured event; the append-only event stream is the
source of truth. Predictive failure signals — planning ratio (P-Ratio),
Plan-Explore-Plan spirals, E→V deficit, repeated identical calls — are
derived over the stream. Completion is owned by a deterministic verifier
validated on negative fixtures (the TNR gate). Replay-with-patch is the
debugging substrate: the error's surfacing step is not necessarily the cause
step. The package never writes to the session log or message history — every
pass returns NEW derived values (golden rule).

## Model Experience

- **Zero model calls in the deterministic core.** `computeMetrics()`,
  `evaluateSignals()`, `verifyCompletion()`, and `replayWithPatch()` are pure
  deterministic functions — no LLM, no network, no token spend. Stage
  classification is a fixed kind map, not a model pass.
- **Token effects.** None from this package itself. The service holds an
  in-memory ring buffer of structured events (a derived projection, never the
  session log); nothing here adds tokens to context or rewrites projections.
- **KV-cache effects.** None. The package holds no model-visible state and
  never writes to message history.

## Install and mount

```ts
import ObservabilityService from '@atlasai/atsh-factory-observability'

ctx.plugin(ObservabilityService, {
  enabled: true,          // default
  windowSize: 512,        // ring buffer cap
  pRatioAlarm: 0.5,       // planning-ratio alarm threshold
  evDeficitWarn: 0.1,     // verify/(evaluate+verify) warn threshold
  repeatThreshold: 3,     // repeated-identical-calls alarm threshold
})
```

When enabled, the service subscribes to the seven known harness event kinds
(`judge/ballot`, `judge/verdict`, `judge/replan`, `budget/route`,
`budget/veto`, `lane/veto`, `factory/contract-registered`) via `ctx.on` and
records each one into the ring buffer (extracting a short detail from
`account`/`name`/`stage`/`tool` when the payload carries one). When disabled
the service is passive: no subscription is registered, the buffer methods
throw `observability disabled`, and the verifier methods stay available (pure
filters, like lane-guard sanitize).

## Config

| key | type | default | description |
| --- | ---- | ------- | ----------- |
| `enabled` | `boolean` | `true` | when false the service is passive: no harness-event subscription; `record`/`report`/`signalAt`/`reset` throw `observability disabled`; `verifyCompletion`/`validateVerifier` still work |
| `windowSize` | `number` | `512` | ring buffer cap; the oldest event is dropped first (append-only semantics held for the window) |
| `pRatioAlarm` | `number` | `0.5` | planning-ratio alarm threshold: `plan / total` above this fires `high-p-ratio` |
| `evDeficitWarn` | `number` | `0.1` | E→V warn threshold: `verify / (evaluate + verify)` below this fires `e-to-v-deficit` |
| `repeatThreshold` | `number` | `3` | repeated-identical-calls alarm threshold: a run of `>= N` consecutive same `(kind, detail)` events fires `repeated-identical-calls` |

## Events

| event | payload | description |
| ----- | ------- | ----------- |
| `observability/report` | `SignalReport` | the current signal report (metrics, firing signals, verdict), emitted when the signal ids change since the last emission (dedup) |

## The five signals

| signal | severity | condition | grounding |
| ------ | -------- | --------- | --------- |
| `high-p-ratio` | alarm | `pRatio > 0.5` | P-Ratio r=-0.256 — more planning relative to execution predicts failure |
| `e-to-v-deficit` | warn | `eToV < 0.1` | E→V 2.1% — verify transitions are rare relative to evaluate |
| `plan-explore-plan-spiral` | alarm | `pxpSpirals > 0` | the P-X-P trigram is a concrete runtime alarm: a loop between planning and exploring |
| `repeated-identical-calls` | alarm | `maxRepeatRun >= 3` | repeated identical calls are the signature of infinite loops |
| TNR gate (verifier) | gate | `tnr >= 0.8` on negative fixtures | THE TNR problem is existential for a gate: LLM judges accept nearly everything (TNR <25% vs TPR >96%), so verifiers MUST be validated on negative fixtures or they certify garbage |

## Replay-with-patch

`signalAt(index, event)` replays the buffered stream with one event replaced
and reports which signals changed — attribute a silent failure to its cause
step, not its surfacing step:

```ts
const result = ctx.observability.signalAt(4, {
  ts: 4, stage: 'evaluate', kind: 'judge/ballot', detail: 'patched',
})
// result.before   — report over the recorded stream
// result.after    — report with index 4 replaced by the patch
// result.changed  — signal ids whose firing state changed, sorted
```

The input stream is never mutated (the patched stream is a NEW array); an
out-of-bounds index throws `RangeError`.

## Known Limitations and Deferred Work

- **In-memory window only — no persistence.** The ring buffer is scoped to
  the context fiber and dropped on dispose. The harness must feed `record()`;
  this package proves the substrate, the caller wires the events.
- **Signal thresholds are defaults, operator-tunable.** The empirical
  grounding (P-Ratio r=-0.256, E→V 2.1%) sets sane defaults; operators may
  override `pRatioAlarm`, `evDeficitWarn`, and `repeatThreshold` per mount.
- **Stage classification is a deterministic kind map, not a model pass.**
  Kinds outside the map are unclassified and never counted in metrics; a
  richer classifier would be a model pass and lives outside this package.
- **The buffer is a derived projection, not the session log.** Consumers that
  need durable, queryable history must persist events themselves.

## Golden rule

Never writes to the session log or message history — append-only held. Events
are copied into the ring buffer by value (never retained by reference), every
pass returns NEW derived values, and inputs stay byte-identical (asserted in
the package's tests).

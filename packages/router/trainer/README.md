# @atlasai/atsh-router-trainer

English | [中文](README.zh.md)

Auto-training consumer for `@atlasai/atsh-router`: a service that collects
every `router/call-logged` record into `ctx.routerTrainer` for downstream training, with
an optional JSONL output sink. The trainer also threads correction rewards onto corrected
calls: a correction is consumed as a negative-reward signal for the routing decision that
produced it. Service package — default-exports the `RouterTrainer` service class
(registers as `ctx.routerTrainer`), mirroring the `ctx.memoryStore` seam.

## What it adds

- `ctx.routerTrainer` — the `RouterTrainer` service: `count()`, `records()`,
  `reset()`, `onCall(record)`, `recordCorrection(correction)`, `rewards()`,
  and `corrections()`.
- Optional `outputPath` — appends one JSONL line per logged call and one per threaded
  correction (parent directories created, mode `0o700`) for offline training pipelines.
- Correction reward lane — `recordCorrection(correction)` consumes one correction as a
  reward: it appends the correction to the same JSONL log, attaches it to the matching
  recorded call (by `callId`), and records it regardless of whether that call is known.

## Usage

```ts
import { Context } from '@deepseek-ai/cordis'
import Router from '@atlasai/atsh-router'
import RouterTrainer from '@atlasai/atsh-router-trainer'

const ctx = new Context()
await ctx.plugin(Router, {
  routes: { general: { provider: 'deepseek', model: 'deepseek-chat' } },
})
await ctx.plugin(RouterTrainer, { outputPath: './calls.jsonl' })

// after some routed calls:
ctx.routerTrainer.count()    // → samples collected
ctx.routerTrainer.records()  // → the samples, in arrival order

// a correction fired on call '<callId>' (e.g. a retried failed tool):
ctx.routerTrainer.recordCorrection({
  id: 'corr-1',
  callId,                    // the RouterCallRecord.id that was corrected
  ts: Date.now(),
  classification: 'C1',
  note: 'retried failed tool',
})

ctx.routerTrainer.corrections() // → [the consumed correction records]
ctx.routerTrainer.rewards()     // → the samples that carry a correction reward
ctx.routerTrainer.reset()       // → drop samples and corrections
```

## Config (schemastery)

| key | type | default | meaning |
| --- | --- | --- | --- |
| `outputPath` | `string` | — | append one JSONL line per call and per correction to this file |

## Model experience

The trainer never changes what the model sees or which model answers: it is a post-hoc
consumer of the router's call log. Records carry the resolved provider/model, capability,
route state, status, chunk count, and duration — enough to train routing policies without
replaying conversations. Corrections are also post-hoc: they mark a call's routing
decision as worth penalizing, and never enter the model-visible prompt or tool stream.

## Known Limitations and Deferred Work

- In-memory samples and corrections are lost when the plugin fiber unloads; only
  `outputPath` persists.
- No batching, deduplication, or label generation ships yet — samples are raw
  `RouterCallRecord` values with an optional threaded `reward`.
- `reset()` drops the sample and correction queues but does not truncate an
  `outputPath` file.
- Added additively: registers `ctx.routerTrainer`, subscribes to the router's
  `router/call-logged` event, and touches no existing package source.
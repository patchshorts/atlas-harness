# @atlasai/atsh-bench

English | [中文](README.zh.md)

Bench family for the DeepSeek Harness: a deterministic corrections-per-session
benchmark over the append-only session log. Corrections are counted by
deterministic rules — no LLM judgment — across five classes (C1 retried-failed-tool-call,
C2 reverted-file-edit, C3 self-correction message, C4 repaired-plan-deviation,
C5 user correction), and both arms (vanilla clone vs additive harness) run the same
task suite to a paired statistical verdict.

## Status

Classifier (`bench-classify`) complete and unit-tested. The runner (`bench-run`) and
reporter (`bench-report`) modules are added by the later the bench workstream bench loop tasks.

## Usage

The seam mounts as a Cordis service:

```ts
import { Context } from '@deepseek-ai/cordis'
import BenchService from '@atlasai/atsh-bench'

const ctx = new Context()
await ctx.plugin(BenchService, {})
```

## bench-classify

`classifySession(events, config?)` counts C1..C5 corrections in one exported
session log. Input is the harness `SessionEvent` envelope exported as JSON with
`type` and `seq` intact — a bare event array or `{ sessionId, events }`:

```ts
import { classifySession, loadEvents } from '@atlasai/atsh-bench'

const events = loadEvents(sessionLogJson)
const result = classifySession(events)
// { C1: 1, C2: 0, C3: 1, C4: 0, C5: 1 }, total: 3, per100Calls: 12.5,
//   hits: [{ class: 'C1', seq: 9, note: '...' }, ...] }
```

The five rules (benchmark spec §2.1, all in-log and deterministic):

| Class | Rule |
| --- | --- |
| C1 RetriedFailedToolCall | a `tool/result` carrying `error`, followed within 4 events by a `tool/call` of the same tool name |
| C2 RevertedFileEdit | an fs-family write whose content hash equals an earlier write's content hash to the same path (a restore) |
| C3 SelfCorrectionMessage | a model-source `assistant/message` containing a lexicon token, after an erroring result or a todo flip |
| C4 RepairedPlanDeviation | a `todo/write` item flipped `completed` → `in_progress`/`pending` |
| C5 UserCorrection | a `user/message` ≤ 200 chars with a lexicon token, within 6 events of an assistant action |

Spec §2.3 exclusions are structural: first-attempt failures and dead-end errors
never match C1 (no retry call), compaction summaries are their own log event
types and non-model assistant messages are skipped, and user messages over 200
chars are task prose. The C3/C5 lexicon is a config row frozen in
bench-manifest.json before any session runs — `loadConfigFromManifest(path)`
reads it and `matchLexicon(text, tokens)` applies it (lowercased, whole-word,
`use ... instead` phrases split on the ellipsis).

## What it will add

- `bench-run` — N sessions per arm, fresh session dir per session, temperature 0,
  30-minute hard timeout, cost sidecar.
- `bench-report` — paired per-task table, per-class breakdown, cost block with 95%
  CIs, one-sided Wilcoxon signed-rank + McNemar, pass/fail per criterion.

## bench-audit

`bench-audit` applies the deterministic C1..C5 classifier a SECOND time to the
exported session logs and reports agreement against the counts recorded at run
time (first pass, spec §6.4). Run it with
`node --import tsx/esm packages/bench/bench/src/audit/cli.ts --clone-dir <dir>
--additive-dir <dir> [--manifest bench-manifest.json] [--out classifier-audit.md]`;
it writes classifier-audit.md + classifier-audit.json with per-session
recorded-vs-reclassified tables and the overall agreement (PASS when >= 0.95).

## bench loop-guard

The bench preset (`writeHomePatch`) composes a `bench-loop-guard` plugin into
every session's home patch (`$ATSH_HOME/cordis.patch.yml`) when a per-task call
ceiling is configured on a run. The guard stops a session that is grinding to a
blow-up instead of letting it burn the budget:

- **Hard per-task call ceiling** — counts `tools/execute` calls and vetoes every
  call once the ceiling is reached (`BUDGET_EXCEEDED` error result, the tool
  never runs).
- **D4 accounting-cap hook** — reads the optional `ctx.accounting` budget and
  stops the session when the account spend meets its cap.
- **D6 repeated-call / P-Ratio fold** — folds the REAL
  `@atlasai/atsh-runtime-alarms` detectors over the observed runtime event
  stream and escalates a critical repeated-call run or an efficiency collapse
  (low output/input ratio) into the same veto.

Every stop above funnels to one `BUDGET_EXCEEDED` veto at the `tools/execute`
boundary and emits a `bench/guard-veto` event naming which guard tripped, so the
"summarize & submit" fallback can fire instead of a silent hang.

```ts
import { guardPluginPath, writeHomePatch } from '@atlasai/atsh-bench'
// Per run, mount the guard with a call ceiling:
writeHomePatch(atshHome, { model, temperature, maxTokens }, undefined, { callCeiling: 25 })
```

The decision layer (`loopGuardVerdict`, `foldGuard6M`) is pure and unit-tested.

## Config (schemastery)

| key | type | default | meaning |
| --- | --- | --- | --- |
| `lexicon` | `Record<string, string[]>` | `{}` | C1..C5 correction-class lexicon, frozen at run start |
| `model` | `string` | `''` | pinned model for both arms |
| `maxTokens` | `number` | `8192` | per-session generation cap |
| `prices` | `Record<string, number>` | `{}` | cached/uncached price sheet, frozen at run start |

Added additively to the frozen upstream clone: no existing package source is touched.

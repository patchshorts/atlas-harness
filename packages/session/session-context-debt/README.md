# @atlasai/atsh-session-context-debt

Fix 11 context-debt management (`ctx.contextDebt`): retrieval over stuffing,
fold-only compaction plans, and positional placement — critical context at
head/tail. The service is a read-only fold over committed session events: it
never mutates the session log, so the JSONL log stays byte-identical after any
`scan` / `plan` / `report` / `reposition` call.

## Golden rule

This package never writes to session history. Every operation reads the frozen
committed snapshot (`session.events`) and returns derived values. Compaction
plans are fold-only by construction — `CompactionPlan.foldOnly` is hard-typed
to `true`: the derived summary shadows a span of committed seqs, and the
model-visible history reflects the summary only through the fold, never
through a log rewrite. Append-only is held.

## Usage

```ts
import { Context } from '@deepseek-ai/cordis'
import ContextDebtService from '@atlasai/atsh-session-context-debt'

const ctx = new Context()
await ctx.plugin(ContextDebtService, {
  stuffedThresholdTokens: 20000,
  positionalHeadTokens: 2000,
  positionalTailTokens: 2000,
})

const scan = ctx.contextDebt.scan(session)            // debt reports + foldSeq
const plan = ctx.contextDebt.plan(session, 4000)      // fold-only compaction plan
ctx.contextDebt.report(plan)                          // one-line observability string
const { head, tail } = ctx.contextDebt.reposition(plan) // critical head/tail bands
```

## Config

| Key | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Master switch; `scan` / `plan` throw `'context-debt disabled'` when false. |
| `stuffedThresholdTokens` | `20000` | Accumulated non-essential context (tool results, verbatim logs) that triggers a `stuffed` report. |
| `positionalHeadTokens` | `2000` | Token budget of the critical head band. |
| `positionalTailTokens` | `2000` | Token budget of the critical tail band. |

## Events

| Event | Payload | Emitted by |
| --- | --- | --- |
| `context-debt/scan` | `ContextDebtScan` | `scan()` |
| `context-debt/plan` | `CompactionPlan` | `plan()` |

## Model Experience

- **Model calls:** none in the deterministic core. `foldSummary` is a pure
  text fold over committed events; model-backed summary folding is
  caller-driven — call `foldSummary` / `plan` with a budget yourself, never
  from inside the service.
- **Tokens:** every budget (`stuffedThresholdTokens`, `positionalHeadTokens`,
  `positionalTailTokens`, `plan`'s `budgetTokens`) is enforced by the
  deterministic 4-characters-per-token heuristic; the derived summary never
  exceeds its budget.
- **KV cache:** no effect — this package never mutates the log, so the prefix
  cache is unaffected by any operation.

## Known Limitations and Deferred Work

- `reposition` returns head/tail band line arrays; actual assembly of the
  model-visible context from those bands is the caller's wiring.
- `unretrieved` debt is a plan-level signal: the package reports debt and
  produces fold-only plans, but the re-retrieval trigger at decision points
  must be wired by the caller.

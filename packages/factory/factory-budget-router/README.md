# @atlasai/atsh-factory-budget-router

English | [中文](README.zh.md)

Fix 2 token budget + Fix 9 routing for the harness (`ctx.budgetRouter`): a hard
token budget enforced at the `llm/stream` boundary (over-budget calls are
vetoed with `BUDGET_EXCEEDED` before any adapter runs), per-stage model routing
with cumulative-cost conditioning (a tier ladder whose tier choice depends on
cumulative spend), batch prompting for shared system prompts, and cost
reported alongside pass rate.

The golden rule holds: the service never writes to `options.messages` or
`options.system`. Route decisions rewrite only `provider`/`model` metadata on
non-frozen requests, so the request prefix stays byte-identical across stages
(prefix-cache-friendly history is preserved — cached input is priced at
$0.0033/M versus $0.435/M uncached on the pro model, a 131.8x gap).

## Installation

```bash
pnpm add @atlasai/atsh-factory-budget-router
```

## Usage

```ts
import { Context } from '@deepseek-ai/cordis'
import BudgetRouterService from '@atlasai/atsh-factory-budget-router'

const ctx = new Context()
await ctx.plugin(BudgetRouterService, {
  budgets: { default: 1_000_000 },
  stageRoutes: {
    general: [
      { provider: 'deepseek', model: 'pro', maxCumulativeCost: 500_000 },
      { provider: 'deepseek', model: 'cheap', maxCumulativeCost: undefined },
    ],
  },
})

// Read the spend/budget/remaining snapshot for an account
const state = ctx.budgetRouter.budgetState('default')

// Resolve the cost-conditioned route for a stage at a cumulative cost
const route = ctx.budgetRouter.routeForStage('general', 600_000) // cheap tier

// Plan batches by shared system prompts (groups + estimated cache-read savings)
const plan = ctx.budgetRouter.planBatches([{ system: 'S', messages: [] }, { system: 'S', messages: [] }])

// Price a usage record and report cost alongside pass rate
const cost = ctx.budgetRouter.price({ inputTokens: 1_000_000, outputTokens: 0 }) // 0.435
const report = ctx.budgetRouter.reportCostAndPassRate([{ id: 'a', costUsd: 0.435, pass: true }])
```

## Configuration

| key | type | default | description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch; when `false` the service is passive (no veto, no rewrite, no events). |
| `budgets` | Record\<string, number\> | `{}` | Account -> token cap. An `llm/stream` call whose account spend has reached its cap is vetoed with `BUDGET_EXCEEDED`. |
| `stageRoutes` | Record\<string, StageRoute[]\> | `{}` | Stage ('general', ...) -> tier ladder, ascending `maxCumulativeCost`. The first tier whose bound is `undefined` or `>=` the cumulative cost wins; once spend exceeds every bound, the last (cheapest, unbounded) tier applies. |
| `modelCost` | Partial\<ModelCost\> | `{}` | Override the pinned DeepSeek pro constants (`input` $0.435/M, `cacheRead` $0.0033/M; `output`/`cacheWrite` priced 0 pending the provider catalog). |
| `batchPrompting` | boolean | `true` | Group requests sharing the identical system prompt into a batch plan. |
| `applyRoutes` | boolean | `true` | Rewrite non-frozen route mismatches; frozen requests always degrade to advisory (never mutated). |

## Model Experience

- **Model-visible surface**: `ctx.budgetRouter` — `budgetState`, `routeForStage`,
  `planBatches`, `price`, `reportCostAndPassRate`, `cacheRatio`. The pure
  routing and batch-planning functions (`selectTier`, `routeForStage`,
  `matchRoute`, `estimateSystemTokens`, `planBatches`) are exported for
  callers that assemble their own batches.
- **Tokens**: none in the deterministic core — this package makes zero model
  calls. Batch planning returns groups; actual request assembly is caller
  wiring.
- **KV cache**: none. Budget enforcement reads accounting's ledger via
  `ctx.get` (optional); the service holds no spend state of its own and no
  KV-cache or persistent storage effects.

## Events

- `budget/veto` (`BudgetVetoRecord`) — a hard budget veto stopped an
  `llm/stream` call: the account's spend reached its configured budget, and
  the call is rejected with `BUDGET_EXCEEDED` before any adapter runs.
- `budget/route` (`BudgetRouteDecision`) — an `llm/stream` call settled with
  its cost-conditioned route decision (account, stage, cumulative cost,
  requested and resolved provider/model, route state).

## Known Limitations and Deferred Work

- Budget enforcement requires `@atlasai/atsh-accounting` mounted: spend is
  read via `ctx.get('accounting')`, so without accounting the service is
  passive (spend reads 0, no vetoes).
- `output`/`cacheWrite` prices are pinned at 0 pending the provider catalog
  (RECON gap, 2026-08-17); the pinned pair is input $0.435/M versus
  `cacheRead` $0.0033/M, and `cacheRatio()` makes the 131.8x gap a computed,
  testable number.
- Batch planning returns groups and estimated cache-read savings — actual
  request assembly (batching multiple calls into one request) is caller
  wiring.
- Golden rule: the service never touches `options.messages`/`options.system`
  — route decisions rewrite only `provider`/`model` metadata on non-frozen
  requests (append-only held).

## License

MIT

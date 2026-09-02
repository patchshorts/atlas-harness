# @atlasai/atsh-router

English | [中文](README.zh.md)

Capability-gated LLM routing for the DeepSeek Harness: a `ctx.llmRouter` service that
intercepts the `llm/stream` Cordis waterfall, rewrites `provider` / `model` for non-frozen
requests that mismatch their capability's configured route, and logs every completed call
to a SQLite call log. The companion `@atlasai/atsh-router-trainer` package consumes the
`router/call-logged` records for auto-training.

## What it adds

- `ctx.llmRouter` — the `LlmRouter` service. Load it as a plugin; it registers the
  `llm/stream` waterfall listener on the same context (one router per context).
- Capability-gated routing — each call is classified as `options.purpose ?? 'general'`
  and matched against `config.routes[capability]`.
- Golden-rule-safe rewrites — loop-built requests arrive deep-frozen and are never
  mutated: a frozen mismatch logs `route_state: 'advisory'` and the call goes out exactly
  as requested. Only non-frozen requests with `applyRoutes` on are rewritten in place.
- SQLite call log — every completed call lands in the `call_log` table (Node's built-in
  `node:sqlite`; no npm dependency) and is emitted as the `router/call-logged` event.
- Public surface: `routeFor(capability)`, `listCalls(limit?)`, `countCalls()`.

## Usage

```ts
import { Context } from '@deepseek-ai/cordis'
import LlmRouter from '@atlasai/atsh-router'

const ctx = new Context()
await ctx.plugin(LlmRouter, {
  routes: {
    general: { provider: 'deepseek', model: 'deepseek-chat' },
    reasoning: { provider: 'deepseek', model: 'deepseek-reasoner' },
  },
})
```

With the router mounted, every `ctx.llm.stream(...)` call on the same context is
classified, routed, and logged:

```ts
ctx.llmRouter.countCalls()          // → number of logged calls
ctx.llmRouter.listCalls(20)         // → newest 20 RouterCallRecords
ctx.llmRouter.routeFor('reasoning') // → { provider: 'deepseek', model: 'deepseek-reasoner' }
```

## Config (schemastery)

| key | type | default | meaning |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | intercept the `llm/stream` waterfall |
| `applyRoutes` | `boolean` | `true` | rewrite non-frozen mismatched requests |
| `routes` | `dict<{provider, model}>` | `{}` | capability → route map |
| `sqlite.path` | `string` | `':memory:'` | call-log database file path |

Unknown config keys are rejected at load time (`RouterConfig: unknown key "..."`).

## Model experience

The router never touches messages, system prompts, or content blocks — it selects the
model per call. Routing changes which model answers a capability, so token economics and
provider-specific behavior follow the resolved route, and a rewritten route invalidates
any KV cache keyed by the previously requested provider/model pair. Advisory decisions
(frozen requests) leave the requested route intact and log the gap for later tuning.

## Known Limitations and Deferred Work

- Routing is capability-gated by `purpose` only — no per-session or per-model override
  yet, and no automatic route failover when a resolved provider errors.
- The call log grows monotonically; no retention/eviction policy ships yet.
- `route_state: 'none'` (no configured route) still logs the call — useful for
  observability, but it means the log records calls the router did not route.
- Added additively to the frozen upstream clone: registers `ctx.llmRouter`, appends the
  `router/call-logged` event, and touches no existing package source.

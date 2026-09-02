# @atlasai/atsh-coordination

English | [中文](README.zh.md)

C2 orchestration (controller-of-controllers) for the DeepSeek Harness: a
`ctx.coordination` service that spawns subagent "workers" through the EXISTING
subagent registry (`ctx.subagents`) and coordinates them through a
SQLite-backed shared-state channel. The registry is consumed, never modified —
coordination adds a controller layer on top of providers that other packages
register and own.

## What it adds

- `ctx.coordination` — the `CoordinationService` service. Load it as a plugin;
  it requires the subagent registry (`static inject = ['subagents']`) and
  registers one service per context (loading a second throws, cordis' standard
  duplicate-service behavior).
- Worker registry — `spawnWorker(provider, request)` looks the provider up in
  `ctx.subagents`, starts the run, inserts a `'running'` row in the
  `coord_workers` table, awaits the run's settlement, and flips the row to
  `'completed'` (outcome = joined text output, or `JSON.stringify(structured)`
  when the run returned one) or `'failed'` (outcome = the error text).
- Shared-state channels — `postState(channel, key, value)` upserts a
  JSON-serialized entry with a monotonic per-(channel, key) revision starting
  at 1; `getState(channel, key)` and `listChannel(channel)` read entries back
  (JSON round-trip). Writes reject non-serializable values with a `TypeError`.
- SQLite backend — rows land in the `coord_workers` + `coord_shared_state`
  tables (Node's built-in `node:sqlite`; no npm dependency), closed when the
  owning fiber unloads. `SCHEMA_VERSION = 1` marks the schema.
- Public surface: `spawnWorker()`, `getWorker()`, `listWorkers()`,
  `getStats()`, `postState()`, `getState()`, `listChannel()`.
- Events: `coordination/worker-started` (`{ workerId, provider }`) and
  `coordination/worker-completed` (`{ workerId, provider, status }`), both
  emitted after their row lands.

## Usage

```ts
import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@atlasai/atsh-subagent'
import CoordinationService from '@atlasai/atsh-coordination'

const ctx = new Context()
await ctx.plugin(SubagentRuntime)
// providers register themselves; coordination only consumes the registry
await ctx.plugin(CoordinationService, {})
```

With coordination mounted, delegate to a registered provider and coordinate
through shared state:

```ts
const workerId = await ctx.coordination.spawnWorker('spawn', {
  label: 'w1',
  prompt: [{ type: 'text', text: 'build the thing' }],
  parent,
  signal,
})
ctx.coordination.getWorker(workerId)   // → { status: 'completed', outcome: '...' }
ctx.coordination.postState('build', 'result', { ok: true })  // → { revision: 1 }
ctx.coordination.getState('build', 'result')                 // → { value: { ok: true }, ... }
```

## Config (schemastery)

| key | type | default | meaning |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | allow `spawnWorker` / `postState`; with `false` the service still registers but both reject with `coordination disabled` |
| `sqlite.path` | `string` | `':memory:'` | coordination database file path |

Unknown config keys are rejected at load time (`CoordinationConfig: unknown key "..."`).

## Known Limitations and Deferred Work

- The service consumes the subagent registry and never modifies it: no
  providers are registered, replaced, or removed, and provider lifecycle stays
  with the packages that own them. A provider that unregisters while a worker
  is in flight leaves that worker's row to settle on its own.
- No `ctx.tools` tool exposes coordination to the model yet; drive it via the
  service API or events.
- `spawnWorker` awaits the run's settlement before returning, so a long-lived
  worker blocks the caller; a fire-and-track variant that returns while the
  worker runs is a possible follow-up.

# @atlasai/atsh-factory

English | [中文](README.zh.md)

Factory role workflows for the harness (`ctx.factory`): a plan-contract
registry, deterministic BAR critic scoring for submitted work, and planner /
developer / critic role-objective builders that generate the immutable
`objective` input for the ralph tool.

## Installation

```bash
pnpm add @atlasai/atsh-factory
```

## Usage

```ts
import { Context } from '@deepseek-ai/cordis'
import FactoryService from '@atlasai/atsh-factory'

const ctx = new Context()
await ctx.plugin(FactoryService, { enabled: true, maxPlanTasks: 100 })

// 1. register a plan contract
ctx.factory.registerPlanContract('plan-1', [
  {
    id: 't1',
    verb: 'implement',
    object: 'the auth module',
    verifies: 'auth module exposes login()',
  },
])

// 2. score a submission with the deterministic BAR judge
const verdict = ctx.factory.scoreTask('plan-1', {
  taskId: 't1',
  summary: 'implemented the auth module',
  evidence: ['unit tests pass'],
  files: ['src/auth.ts'],
})

// 3. build role objectives for the ralph tool
const objective = ctx.factory.buildRoleObjective('planner', {
  scope: 'build the factory capability',
})
```

## Configuration

| key | type | default | description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Accept plan-contract registration. Reads (`getPlanContract`, `listPlanIds`) and scoring stay available when disabled. |
| `maxPlanTasks` | number | `100` | Maximum number of atomic tasks a single plan contract may contain. |

## Model Experience

- **Model-visible surface**: `ctx.factory` — `registerPlanContract`,
  `getPlanContract`, `listPlanIds`, `scoreTask`, `scoreContract`,
  `buildRoleObjective`. Role objectives produced by the builders are pure,
  deterministic strings intended as the single immutable `objective` input of
  the ralph tool.
- **Tokens**: none. This package makes no LLM calls and never contributes
  tokens to any prompt.
- **KV cache**: none. The contract registry is an in-memory `Map` scoped to
  the context fiber; no KV-cache or persistent storage effects.

## Events

- `factory/contract-registered` (`{ planId: string; count: number }`) —
  emitted after a plan contract is registered or replaced.

## Known Limitations and Deferred Work

- Scoring is a deterministic clause check (summary, evidence, files); it does
  not execute the claimed work or verify the evidence content.
- `scoreContract` scores only the first submission per task id; duplicate
  submissions for one task are ignored.
- The registry is per-context memory; there is no cross-session persistence
  of plan contracts yet.

## License

MIT

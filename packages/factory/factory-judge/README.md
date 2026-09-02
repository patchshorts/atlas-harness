# @atlasai/atsh-factory-judge

English | [中文](README.zh.md)

Pass 4 unanimous three-panel judge for the harness (`ctx.factoryJudge`): a
pre-commit gate for plans, failure triage, and completion verdicts. Three
independent panel roles — decomposition, feasibility, verification — vote YES
or NO on the plan artifact; a single NO is a dissent, not an average. Dissent
triggers a bounded replan loop (charged to accounting), and exhausted replans
escalate to the caller. Every ballot and verdict is emitted to the event
stream.

The judge never touches session log, message history, or projections. It
operates on plan artifacts only (golden rule — append-only held).

## Installation

```bash
pnpm add @atlasai/atsh-factory-judge
```

## Usage

```ts
import { Context } from '@deepseek-ai/cordis'
import JudgeService from '@atlasai/atsh-factory-judge'

const ctx = new Context()
await ctx.plugin(JudgeService, { enabled: true, maxReplans: 3, replanCost: 1500 })

// Judge a plan with the full three-role panel
const verdict = ctx.factoryJudge.judge({
  judgmentId: 'j1',
  planId: 'plan-1',
  revision: 'r1',
  kind: 'plan',
  tasks: [
    { id: 't1', verb: 'implement', object: 'the auth module', verifies: 'auth module exposes login()' },
  ],
})
// verdict.verdict === 'PASS' only when all three roles vote YES

// Gate a completion against a previously approved plan artifact
const completion = ctx.factoryJudge.judge({
  judgmentId: 'j2',
  planId: 'plan-1',
  revision: 'r1',
  kind: 'completion',
  tasks: [{ id: 't1', verb: 'implement', object: 'the auth module', verifies: 'auth module exposes login()' }],
  submission: { summary: 'auth module implemented', evidence: ['tests pass'], files: ['src/auth.ts'] },
})

// Read the replan budget, or reset it
ctx.factoryJudge.replanState('j1')
ctx.factoryJudge.resetJudgment('j1')
```

## Configuration

| key | type | default | description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Accept judgments. Reads (`isPlanApproved`, `replanState`, `resetJudgment`) stay available when disabled. |
| `maxReplans` | number | `3` | Maximum replans per judgment before the verdict escalates. |
| `replanCost` | number | `1500` | Token charge per replan, written to accounting as a `judge-replan` debit. |

## Model Experience

- **Model-visible surface**: `ctx.factoryJudge` — `judge`, `isPlanApproved`,
  `replanState`, `resetJudgment`. The three role charters are exposed as the
  pure `judgeRoleObjective(role, kind)` builder.
- **Tokens**: none in the deterministic core — this package makes zero model
  calls. Model-backed judges are driven by the caller through
  `judgeRoleObjective` with fresh context per role.
- **KV cache**: none. Ballot and replan state are in-memory `Map`s scoped to
  the context fiber; no KV-cache or persistent storage effects.

## Events

- `judge/ballot` (`JudgeVote`) — one role's ballot was cast for a judgment.
- `judge/replan` (`{ judgmentId, planId, kind, round, cost }`) — a replan was
  granted on dissent with replan budget remaining.
- `judge/verdict` (`JudgeVerdict`) — a judgment round settled (PASS / REPLAN /
  ESCALATE) with every ballot of the round.

## Known Limitations and Deferred Work

- Escalation policy (stakes thresholds, single-judge default) is the caller's
  wiring, not the service: ESCALATE hands the judgment back with no further
  replans, and the caller decides what stakes imply.
- Model-backed feasibility and verification votes are caller-driven: the
  deterministic core votes on artifact structure, while the caller may run
  model judges through `judgeRoleObjective` and merge their ballots.
- Fresh context per judge is a guarantee of the deterministic engine (votes
  are computed from request + charter only); the service keeps no ballot state
  between roles.
- Golden rule: the judge never touches session log, message history, or
  projections — it operates on plan artifacts only (append-only held).

## License

MIT

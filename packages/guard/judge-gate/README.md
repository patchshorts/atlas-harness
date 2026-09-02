# @atlasai/atsh-judge-gate

English | [中文](README.zh.md)

Enforce the Pass 4 three-panel judge at the three moments the SAD mandates
(`ctx.judgeGate`): plan admission, task completion, and exit review. The gate
parses a presented plan into atomic tasks, submits it to the existing
`ctx.factoryJudge` panel (three independent roles, unanimous YES), and fails
closed — a rejected plan or claim throws `JudgeGateError` carrying the verdict
and every ballot reason, so the model revises with exact artifact-citing
feedback. The gate is a seam, not a second judge: it owns no ballot state and
adds no events; ballots and verdicts ride the existing `judge/*` stream.

The gate never touches session log, message history, or projections — plan
artifacts only (golden rule).

## Installation

```bash
pnpm add @atlasai/atsh-judge-gate
```

## Usage

```ts
import { Context } from '@deepseek-ai/cordis'
import JudgeGateService from '@atlasai/atsh-judge-gate'

const ctx = new Context()
await ctx.plugin(JudgeGateService, { enabled: true, maxReplans: 2 })

// Plan admission: NOT PASS throws JudgeGateError (ballot reasons included)
try {
  ctx.judgeGate.admitPlan({
    planId: 'session-1:plan',
    revision: 'r1',
    planMarkdown: '1. [fix] everything — verifies: ',
  })
} catch (error) {
  // error.verdict.verdict === 'REPLAN' | 'ESCALATE'; error.reasons cites the artifact
}

// Task completion / exit review: require a prior plan approval by default
const verdict = ctx.judgeGate.checkCompletion({
  planId: 'session-1:plan',
  revision: 'r1',
  submission: { summary: 'auth module implemented', evidence: ['tests pass'], files: ['src/auth.ts'] },
})

// Pure parser, exported for tests: same markdown → same tasks
import { parsePlanTasks } from '@atlasai/atsh-judge-gate'
const tasks = parsePlanTasks('1. [implement] the auth module — verifies: login() exists')
```

## Configuration

| key | type | default | description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Whether the gate accepts judgments. |
| `maxReplans` | number | `2` | Maximum replans per judgment before escalation (D2: N≤2). Enforced by the gate's budget pre-check against the panel's replan counter; the panel's own default budget (3) never grants more than this at the gate's moments. |
| `requirePlanApproval` | boolean | `true` | Completion/exit votes require a prior plan approval for the plan id. |

## Model Experience

- **Model-visible surface**: `ctx.judgeGate` — `admitPlan`, `checkCompletion`,
  `reviewExit`, `parsePlanTasks`. Rejection surfaces as a tool error carrying
  `JudgeGateError` fields (`verdict`, `reasons`, `tasks`) — no extra UI
  vocabulary.
- **Tokens**: none in the gate — zero model calls. The panel's replan charges
  (if any) are written by the judge service to accounting, unchanged.
- **KV cache**: none. The gate's admission registry (planId → admitted
  revision + parsed tasks, required for completion/exit votes) is in-memory
  and scoped to its context; the panel's ballot and replan state lives in
  `ctx.factoryJudge`, scoped to its context.

## Events

The gate adds no events. Ballots, replans, and verdicts ride the existing
`judge/*` stream emitted by `ctx.factoryJudge` (`judge/ballot`,
`judge/replan`, `judge/verdict`).

## Known Limitations and Deferred Work

- `requirePlanApproval: false` disables only the gate's own admission
  pre-check; the panel's approval requirement (factoryJudge is read-only)
  still applies to kind 'completion', and an unadmitted plan has no parsed
  tasks for the panel to judge.
- Plan admission is wired in `plan-mode` only when a composition mounts this
  package: the hook resolves `ctx.get('judgeGate')` and skips (today's
  behavior) when absent. Compositions without the factory packages are
  unchanged.
- Completion and exit-review moments have no live harness caller yet: the
  factory loop invokes them at the SAD's moments, and this package proves both
  surfaces via direct service tests. A composition that mounts the gate but
  not the judge panel fails closed at invocation (`factoryJudge` absent).
- The parser accepts the factory L5 row format and the `N. [verb] object —
  verifies: check` form; other plan dialects are skipped row-by-row and the
  decomposition vote flags the gaps.

## License

MIT

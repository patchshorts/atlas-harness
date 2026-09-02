# @atlasai/atsh-tool-factory

English | [中文](README.zh.md)

Model-facing factory tools over `ctx.factory`: `bar_critic` (the BAR judge —
scores submitted work against a registered factory plan-contract task) and
`contract_status` (lists the registered atomic tasks of a factory plan
contract).

## Installation

```bash
pnpm add @atlasai/atsh-tool-factory
```

## Tools

### bar_critic

Scores a submission against a registered factory plan-contract task with the
deterministic BAR judge. Arguments: `planId`, `taskId`, `summary`, `evidence`
(string[]), `files` (string[]), optional `blockers` (string[]). Returns a
`verdict` object (`taskId`, `status` PASS|FAIL|NOT_SUBMITTED, `passedChecks`,
`reasons`).

### contract_status

Lists the registered atomic tasks of a factory plan contract. Arguments:
`planId`. Returns `{ planId, tasks }` where each task carries `id`, `verb`,
`object`, and `verifies`.

## Model Experience

- **Model-visible surface**: the `bar_critic` and `contract_status` tools.
  Both are thin adapters over `ctx.factory`; no prompt text or tokens are
  added beyond the tool schemas themselves.
- **Tokens**: none beyond tool-schema rendering.
- **KV cache**: none.

## Known Limitations and Deferred Work

- `bar_critic` scoring is the deterministic clause check from
  `@atlasai/atsh-factory`; it does not execute or verify the submitted
  evidence.
- `contract_status` requires the plan contract to have been registered on the
  same context.

## License

MIT

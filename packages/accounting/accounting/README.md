# @atlasai/atsh-accounting

English | [中文](README.zh.md)

Token accounting ledger for the DeepSeek Harness: a `ctx.accounting` service that
debits ledger rows from intercepted `llm/stream` usage, records credit grants, and —
when a per-account budget cap is configured — vetoes tool calls at the
`tools/execute` boundary before dispatch.

## What it adds

- `ctx.accounting` — the `AccountingService` service. Load it as a plugin; it
  registers the `llm/stream` (debits) and `tools/execute` (budget-cap vetoes)
  waterfall listeners on the same context (one ledger per context).
- Ledger — every completed llm call that reports usage appends a `debit` row
  (negative amount, `balance_after` snapshot) using the token-meter fold:
  `inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens`. The stream
  itself is never altered — chunks pass through verbatim and errors re-throw
  untouched.
- Credits — `grant(amount, reason, account?)` upserts the account balance and
  appends a `grant` row; `credits` config seeds the `'default'` account on mount
  (idempotent — applied only when the account does not exist).
- Budget caps — with `budgets` configured for an account, a tool call is vetoed
  once that account's total debit spend reaches the cap: the caller receives an
  `isError` result with `error.info.code === 'BUDGET_EXCEEDED'` and the tool
  never runs. Accounts with no cap entry always pass through — accounting is
  passive for them, so the standard preset stays safe.
- SQLite backend — rows land in the `ledger` + `accounts` tables (Node's built-in
  `node:sqlite`; no npm dependency), closed when the owning fiber unloads.
- Public surface: `grant()`, `getBalance()`, `spendFor()`, `listLedger()`,
  `getStats()`.
- Events: `accounting/debit` (a debit row was committed) and `accounting/grant`
  (a grant row was committed), both carrying `{ account, amount, reason, balanceAfter }`.

## Usage

```ts
import { Context } from '@deepseek-ai/cordis'
import AccountingService from '@atlasai/atsh-accounting'

const ctx = new Context()
await ctx.plugin(AccountingService, { credits: 10_000 })
```

With accounting mounted, every `ctx.llm.stream(...)` call on the same context is
metered, and every `ctx.tools.execute(...)` call is guarded against the account's
cap:

```ts
ctx.accounting.getBalance()   // → remaining tokens
ctx.accounting.getStats()     // → { grants, debits, accounts }
```

## Config (schemastery)

| key | type | default | meaning |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | register the `llm/stream` + `tools/execute` listeners |
| `credits` | `number` | `0` | initial grant to the `'default'` account (once) |
| `budgets` | `Record<string, number>` | `{}` | per-account debit-spend caps; absent account = never vetoed |
| `sqlite.path` | `string` | `':memory:'` | ledger database file path |

Unknown config keys are rejected at load time (`AccountingConfig: unknown key "..."`).

## Known Limitations and Deferred Work

- Debits are written when the stream settles, even if the call errored after
  reporting usage — the usage was consumed regardless, but an
  error-aware `store-on-success-only` mode (mirroring `dsh-cache`) is a possible
  follow-up.
- No `ctx.tools` tool exposes the ledger to the model yet; read it via the
  service API or events.

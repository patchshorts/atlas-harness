/**
 * Token accounting ledger (`ctx.accounting`): debits ledger rows from
 * intercepted `llm/stream` usage (the token-meter fold), records credit grants,
 * and — when a per-account budget cap is configured — vetoes tool calls at the
 * `tools/execute` boundary before dispatch.
 *
 * The service is passive by default: with no `budgets` entry for an account,
 * every tool call passes through untouched (the standard preset stays safe),
 * and llm calls are NEVER vetoed — the wrapped stream always runs and re-throws
 * errors exactly as it would without accounting.
 *
 * @module @atlasai/atsh-accounting/service
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@atlasai/atsh-llm'
import type {
  ToolDispatchExecution,
  ToolExecutionResult,
} from '@atlasai/atsh-tools'
import type {
  AccountingConfig,
  AccountingStats,
  LedgerKind,
  LedgerRow,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    accounting: AccountingService
  }
}

const SUPPORTED_CONFIG_KEYS = new Set(['enabled', 'credits', 'budgets', 'sqlite'])

/** Reject stale or misspelled config keys before defaults can hide them. */
function validateConfigKeys(config: AccountingConfig): void {
  for (const key of Object.keys(config)) {
    if (!SUPPORTED_CONFIG_KEYS.has(key)) {
      throw new Error(`AccountingConfig: unknown key "${key}"`)
    }
  }
}

/** One physical `ledger` row as read back by the service. */
interface LedgerRowShape {
  id: string
  ts: number
  account: string
  kind: string
  amount: number
  balance_after: number
  reason: string
  meta: string
}

/** One physical `accounts` row as read back by the service. */
interface AccountRow {
  account: string
  balance: number
}

/**
 * Open (creating if needed) the accounting database and ensure the `accounts`
 * and `ledger` tables exist. `:memory:` skips all filesystem setup; a file path
 * creates missing parent directories.
 * @param path - database file path or `:memory:`.
 * @returns the open handle with the schema ensured.
 */
function openDatabase(path: string): DatabaseSync {
  const actual = path === ':memory:' ? ':memory:' : resolve(path)
  if (actual !== ':memory:') {
    mkdirSync(dirname(actual), { recursive: true, mode: 0o700 })
  }
  const db = new DatabaseSync(actual)
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      account TEXT PRIMARY KEY,
      balance INTEGER NOT NULL
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ledger (
      id            TEXT PRIMARY KEY,
      ts            INTEGER NOT NULL,
      account       TEXT NOT NULL,
      kind          TEXT NOT NULL,
      amount        INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reason        TEXT NOT NULL,
      meta          TEXT NOT NULL
    )
  `)
  return db
}

/** Rehydrate one physical ledger row into a model-facing record. */
function toRecord(row: LedgerRowShape): LedgerRow {
  return {
    id: row.id,
    ts: row.ts,
    account: row.account,
    kind: row.kind as LedgerKind,
    amount: row.amount,
    balanceAfter: row.balance_after,
    reason: row.reason,
    meta: JSON.parse(row.meta) as Record<string, unknown>,
  }
}

/**
 * Token accounting ledger. Load as a plugin (`ctx.plugin(AccountingService,
 * config)`); it registers as `ctx.accounting` (one ledger per context — loading
 * a second throws, cordis' standard duplicate-service behavior) and, when
 * enabled, listens on the `llm/stream` waterfall (debits) and the
 * `tools/execute` waterfall (budget-cap vetoes). The SQLite backend closes when
 * the owning fiber unloads.
 */
export class AccountingService extends Service {
  static Config = z.object({
    enabled: z.boolean(),
    credits: z.number(),
    budgets: z.dict(z.number()),
    sqlite: z.object({ path: z.string() }),
  })

  /** Open ledger database handle (public for tests/inspection). */
  readonly db: DatabaseSync

  private readonly budgets: Record<string, number>

  constructor(ctx: Context, config: AccountingConfig) {
    super(ctx, 'accounting')
    validateConfigKeys(config)
    this.budgets = config.budgets ?? {}
    this.db = openDatabase(config.sqlite?.path ?? ':memory:')
    this.ctx.effect(() => () => { this.db.close() }, 'dsh-accounting: close ledger database')
    if (config.credits !== undefined && config.credits > 0) {
      const existing = this.db.prepare(
        'SELECT account, balance FROM accounts WHERE account = ?',
      ).get('default') as AccountRow | undefined
      if (existing === undefined) {
        this.grant(config.credits, 'initial credits')
      }
    }
    if (config.enabled ?? true) {
      this.ctx.on('llm/stream', (options, next) => this.handleStream(options, next))
      this.ctx.on('tools/execute', async (exec, next) => this.guardTool(exec, next))
    }
  }

  /**
   * Credit an account: upsert its `accounts` row (`balance += amount`), append
   * a `'grant'` ledger row, and emit `accounting/grant`.
   * @param amount - token count to grant (positive).
   * @param reason - why the grant was written (surfaced in the ledger row).
   * @param account - account id (default `'default'`).
   * @returns the account balance after the grant.
   */
  grant(amount: number, reason: string, account: string = 'default'): number {
    const existing = this.db.prepare(
      'SELECT account, balance FROM accounts WHERE account = ?',
    ).get(account) as AccountRow | undefined
    const balanceAfter = (existing?.balance ?? 0) + amount
    if (existing === undefined) {
      this.db.prepare('INSERT INTO accounts (account, balance) VALUES (?, ?)').run(account, balanceAfter)
    } else {
      this.db.prepare('UPDATE accounts SET balance = ? WHERE account = ?').run(balanceAfter, account)
    }
    this.insertLedger('grant', account, amount, balanceAfter, reason, {})
    const record = { account, amount, reason, balanceAfter }
    this.ctx.emit('accounting/grant', record)
    return balanceAfter
  }

  /**
   * Charge an account: append a `'debit'` ledger row (negative amount) and emit
   * `accounting/debit`. The public entry point for non-llm charges (e.g. judge
   * replan cost); identical ledger semantics to the intercepted `llm/stream` debits.
   * @param account - account id to charge.
   * @param amount - token count to charge (positive; the ledger row is negative).
   * @param reason - why the charge was written (surfaced in the ledger row).
   * @param meta - free-form metadata for the ledger row.
   * @throws {TypeError} When amount is not a positive finite number.
   */
  charge(account: string, amount: number, reason: string, meta: Record<string, unknown>): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new TypeError('accounting: charge amount must be a positive finite number')
    }
    this.debit(account, amount, reason, meta)
  }

  /**
   * Read an account's current balance; `0` when no account row exists.
   * @param account - account id (default `'default'`).
   * @returns the account's current balance.
   */
  getBalance(account: string = 'default'): number {
    const row = this.db.prepare(
      'SELECT account, balance FROM accounts WHERE account = ?',
    ).get(account) as AccountRow | undefined
    return row?.balance ?? 0
  }

  /**
   * Total debit spend for an account: the sum of |amount| of its debit rows.
   * @param account - account id (default `'default'`).
   * @returns the account's total debit spend.
   */
  spendFor(account: string = 'default'): number {
    const row = this.db.prepare(
      'SELECT COALESCE(SUM(-amount), 0) AS n FROM ledger WHERE account = ? AND kind = ?',
    ).get(account, 'debit') as { n: number } | undefined
    return row?.n ?? 0
  }

  /**
   * Read the most recent ledger rows, newest first.
   * @param limit - maximum rows to return (default 50).
   * @returns hydrated ledger rows.
   */
  listLedger(limit: number = 50): LedgerRow[] {
    const rows = this.db.prepare(
      'SELECT id, ts, account, kind, amount, balance_after, reason, meta FROM ledger ORDER BY ts DESC, rowid DESC LIMIT ?',
    ).all(limit)
    return (rows as unknown as LedgerRowShape[]).map(toRecord)
  }

  /**
   * Snapshot of the ledger's table-level counters.
   * @returns the grant/debit/account row counts.
   */
  getStats(): AccountingStats {
    const count = (sql: string, ...params: SQLInputValue[]): number => {
      const row = this.db.prepare(sql).get(...params) as { n: number } | undefined
      return row?.n ?? 0
    }
    return {
      grants: count('SELECT COUNT(*) AS n FROM ledger WHERE kind = ?', 'grant'),
      debits: count('SELECT COUNT(*) AS n FROM ledger WHERE kind = ?', 'debit'),
      accounts: count('SELECT COUNT(*) AS n FROM accounts'),
    }
  }

  /**
   * Intercept one `llm/stream` call: always call `next()` and wrap the chained
   * stream, forwarding every chunk verbatim. When the stream settles, the last
   * `usage` chunk seen (the token-meter fold: input + cache read + cache write
   * + output) is debited to the session account — or skipped when the stream
   * reported no usage or threw (an error re-throws untouched, like the router).
   */
  private handleStream(
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncIterable<StreamChunk> {
    // Closure capture: a generator body has no `this` binding (mirrors the
    // router's captured `finish` closure).
    const debit = (usage: TokenUsage): void => {
      const tokens = usage.inputTokens
        + (usage.cacheReadTokens ?? 0)
        + (usage.cacheWriteTokens ?? 0)
        + usage.outputTokens
      if (tokens > 0) {
        this.debit(
          options.sessionId ?? 'default',
          tokens,
          'llm-call',
          { provider: options.provider, model: options.model },
        )
      }
    }
    return (async function* wrapped(): AsyncGenerator<StreamChunk> {
      let usage: TokenUsage | undefined
      try {
        const source = next()
        for await (const chunk of source) {
          if (chunk.type === 'usage') usage = chunk.usage
          yield chunk
        }
      } finally {
        if (usage !== undefined) debit(usage)
      }
    })()
  }

  /**
   * Guard one `tools/execute` call against the account's budget cap. When the
   * account has a cap and its spend is already at or above it, veto the call —
   * return an `isError` result WITHOUT calling `next()` (the tool never runs).
   * Accounts with no cap entry always pass through unchanged (accounting is
   * passive for them).
   */
  private async guardTool(
    exec: ToolDispatchExecution,
    next: () => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> {
    const account = exec.agent?.id ?? 'default'
    const cap = this.budgets[account]
    if (cap !== undefined && this.spendFor(account) >= cap) {
      const message = `accounting budget exceeded for account ${account}`
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
        error: { message, info: { name: 'BudgetExceededError', code: 'BUDGET_EXCEEDED' } },
      }
    }
    return next()
  }

  /**
   * Debit an account: append a `'debit'` ledger row (negative amount) and emit
   * `accounting/debit`. Debits never go negative-only — the balance row simply
   * tracks whatever remains after the charge.
   */
  private debit(account: string, amount: number, reason: string, meta: Record<string, unknown>): void {
    const existing = this.db.prepare(
      'SELECT account, balance FROM accounts WHERE account = ?',
    ).get(account) as AccountRow | undefined
    const balanceAfter = (existing?.balance ?? 0) - amount
    if (existing === undefined) {
      this.db.prepare('INSERT INTO accounts (account, balance) VALUES (?, ?)').run(account, balanceAfter)
    } else {
      this.db.prepare('UPDATE accounts SET balance = ? WHERE account = ?').run(balanceAfter, account)
    }
    this.insertLedger('debit', account, -amount, balanceAfter, reason, meta)
    this.ctx.emit('accounting/debit', { account, amount, reason, balanceAfter })
  }

  /** Append one ledger row. */
  private insertLedger(
    kind: LedgerKind,
    account: string,
    amount: number,
    balanceAfter: number,
    reason: string,
    meta: Record<string, unknown>,
  ): void {
    this.db.prepare(
      'INSERT INTO ledger (id, ts, account, kind, amount, balance_after, reason, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), Date.now(), account, kind, amount, balanceAfter, reason, JSON.stringify(meta))
  }
}

export default AccountingService

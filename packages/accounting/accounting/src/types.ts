/**
 * Canonical types for `@atlasai/atsh-accounting`: accounting configuration,
 * the ledger vocabulary, the `accounting/debit` / `accounting/grant` event
 * payloads, and the stats snapshot. Types only — no runtime code.
 * @module @atlasai/atsh-accounting/types
 */

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A debit ledger row was written for a completed `llm/stream` call. Fires
     * once per stream that reported usage, after the stream finished.
     * @param record - the debit row: account, token amount, reason, and balance after.
     * @mode emit
     */
    'accounting/debit'(record: AccountingDebitRecord): void
    /**
     * A credit grant ledger row was written (initial credits or an explicit
     * `grant()` call). Fires after the row is committed.
     * @param record - the grant row: account, token amount, reason, and balance after.
     * @mode emit
     */
    'accounting/grant'(record: AccountingGrantRecord): void
  }
}

/** Configuration for the {@link AccountingService} service. */
export interface AccountingConfig {
  /**
   * Intercept the `llm/stream` waterfall (debits) and the `tools/execute`
   * waterfall (budget-cap vetoes). Defaults to `true`.
   */
  enabled?: boolean
  /**
   * Initial credit grant to the `'default'` account on mount, applied only
   * when the account does not exist yet (idempotent across reloads). Defaults
   * to `0` — no grant.
   */
  credits?: number
  /**
   * Per-account spend caps in tokens; the key is the account id (`exec.agent.id`
   * for tool calls, `options.sessionId` for llm calls). An account with no
   * entry is never vetoed (accounting is passive for it).
   */
  budgets?: Record<string, number>
  /** SQLite ledger-backend options. */
  sqlite?: {
    /** Database file path, or `':memory:'` (the default) for an in-process ledger. */
    path?: string
  }
}

/** Which ledger row kind a row records. */
export type LedgerKind = 'grant' | 'debit'

/** One ledger row, hydrated from the `ledger` table. */
export interface LedgerRow {
  /** Ledger row id (uuid). */
  id: string
  /** Row timestamp (epoch ms). */
  ts: number
  /** Account the row belongs to. */
  account: string
  /** Row kind: `'grant'` (positive amount) or `'debit'` (negative amount). */
  kind: LedgerKind
  /** Signed amount: positive for grants, negative for debits. */
  amount: number
  /** Account balance after this row was applied. */
  balanceAfter: number
  /** Why the row was written (`'initial credits'`, `'llm-call'`, ...). */
  reason: string
  /** Free-form metadata (provider/model for llm-call debits). */
  meta: Record<string, unknown>
}

/** Snapshot of the ledger's table-level counters. */
export interface AccountingStats {
  /** Ledger rows with `kind = 'grant'`. */
  grants: number
  /** Ledger rows with `kind = 'debit'`. */
  debits: number
  /** Rows in the `accounts` table. */
  accounts: number
}

/**
 * One debit: tokens charged to an account for a completed llm call.
 */
export interface AccountingDebitRecord {
  /** Account charged. */
  account: string
  /** Token count debited (positive number; the ledger row amount is negative). */
  amount: number
  /** Why the debit was written. */
  reason: string
  /** Account balance after the debit was applied. */
  balanceAfter: number
}

/**
 * One credit grant: tokens added to an account's balance.
 */
export interface AccountingGrantRecord {
  /** Account credited. */
  account: string
  /** Token count granted. */
  amount: number
  /** Why the grant was written. */
  reason: string
  /** Account balance after the grant was applied. */
  balanceAfter: number
}

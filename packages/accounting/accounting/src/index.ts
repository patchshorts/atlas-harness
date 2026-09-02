/**
 * Token accounting ledger (`ctx.accounting`): debits ledger rows from
 * intercepted `llm/stream` usage, records credit grants, and — when a
 * per-account budget cap is configured — vetoes tool calls at the
 * `tools/execute` boundary before dispatch.
 * @module @atlasai/atsh-accounting
 */

export { default, AccountingService } from './service.ts'
export type {
  AccountingConfig,
  AccountingDebitRecord,
  AccountingGrantRecord,
  AccountingStats,
  LedgerKind,
  LedgerRow,
} from './types.ts'

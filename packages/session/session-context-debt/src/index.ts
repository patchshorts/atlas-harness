/**
 * @atlasai/atsh-session-context-debt — ctx.contextDebt.
 *
 * Fix 11 context-debt management: retrieval over stuffing, fold-only
 * compaction plans, positional placement (critical context at head/tail).
 * The service is stateless and never mutates the session log — it reads
 * committed events and returns derived plans. The JSONL log stays
 * byte-identical after any scan/plan/report call (golden rule).
 */
import type { ContextDebtService } from './service.ts'
import type { CompactionPlan, ContextDebtScan } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Context-debt service: scan/plan/report/reposition over a session's
     * committed events. Read-only — never mutates the session log.
     */
    contextDebt: ContextDebtService
  }

  interface Events {
    /**
     * A context-debt scan completed over a session's committed events.
     * @mode emit
     * @param scan - the scan result (reports + foldSeq).
     */
    'context-debt/scan'(scan: ContextDebtScan): void
    /**
     * A fold-only compaction plan was produced for a session.
     * @mode emit
     * @param plan - the produced plan; foldOnly is always `true`.
     */
    'context-debt/plan'(plan: CompactionPlan): void
  }
}

export default ContextDebtService
export { ContextDebtService } from './service.ts'
export * from './types.ts'
export { detectStuffedContext, foldSummary, isFoldOnly, positionalPlacement } from './fold.ts'

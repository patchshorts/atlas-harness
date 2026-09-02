// ContextDebtService: the ctx.contextDebt capability.
//
// Fix 11 context-debt management — retrieval over stuffing, fold-only
// compaction plans, positional placement (critical context at head/tail).
// Golden rule: this service NEVER calls session.log.append with a mutated
// history, never edits the JSONL file, and never hands a mutable history
// array to a provider. It reads committed events and returns derived plans;
// the JSONL log stays byte-identical after any scan/plan/report call.

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@atlasai/atsh-session'
import {
  detectStuffedContext,
  estimateTokens,
  extractEventText,
  foldSummary,
  positionalPlacement,
  stuffedSpan,
} from './fold.ts'
import type { CompactionPlan, ContextDebtConfig, ContextDebtScan } from './types.ts'

const SUPPORTED_CONFIG_KEYS = new Set([
  'enabled',
  'stuffedThresholdTokens',
  'positionalHeadTokens',
  'positionalTailTokens',
])

/** Reject stale or misspelled config keys before defaults can hide them. */
function validateConfigKeys(config: ContextDebtConfig): void {
  for (const key of Object.keys(config)) {
    if (!SUPPORTED_CONFIG_KEYS.has(key)) {
      throw new Error(`ContextDebtConfig: unknown key "${key}"`)
    }
  }
}

/**
 * The context-debt management seam: retrieval over stuffing, fold-only
 * compaction plans, positional placement.
 *
 * Stateless by design: the fold is a pure function and the JSONL log is the
 * only state — this service never writes it. Golden rule: every call reads
 * the committed snapshot (`session.events`, frozen) and returns derived
 * values; the log stays byte-identical after any scan/plan/report call.
 */
export class ContextDebtService extends Service {
  static Config = z.object({
    enabled: z.boolean().default(true),
    stuffedThresholdTokens: z.number().default(20000),
    positionalHeadTokens: z.number().default(2000),
    positionalTailTokens: z.number().default(2000),
  })

  private readonly enabled: boolean
  private readonly stuffedThresholdTokens: number
  private readonly positionalHeadTokens: number
  private readonly positionalTailTokens: number

  constructor(ctx: Context, config: ContextDebtConfig) {
    super(ctx, 'contextDebt')
    validateConfigKeys(config)
    this.enabled = config.enabled ?? true
    this.stuffedThresholdTokens = config.stuffedThresholdTokens ?? 20000
    this.positionalHeadTokens = config.positionalHeadTokens ?? 2000
    this.positionalTailTokens = config.positionalTailTokens ?? 2000
    ctx.effect(() => () => {}, 'session-context-debt: stateless fold service owns no external resources')
  }

  /**
   * Scan a session's committed events for context debt: a `'stuffed'` report
   * when non-essential context (tool results, verbatim logs) exceeds the
   * configured threshold, plus `'positioned'` reports for content outside the
   * critical head/tail bands. Pure read: the log is never touched.
   *
   * @param session - the live session; its frozen committed snapshot is read.
   * @returns the scan result, reflecting the last committed seq.
   * @throws {Error} When the service is disabled (`'context-debt disabled'`).
   * @emits context-debt/scan
   */
  scan(session: Session): ContextDebtScan {
    if (!this.enabled) {
      throw new Error('context-debt disabled')
    }
    const events = session.events
    const reports = []
    const stuffed = detectStuffedContext(events, this.stuffedThresholdTokens)
    if (stuffed) {
      reports.push({ ...stuffed, sessionId: session.id })
    }
    for (const report of positionalPlacement(events, this.positionalHeadTokens, this.positionalTailTokens)) {
      reports.push({ ...report, sessionId: session.id })
    }
    const lastSeq = events.length === 0 ? -1 : (events[events.length - 1] as { seq: number }).seq
    const scan: ContextDebtScan = { sessionId: session.id, reports, foldSeq: lastSeq }
    this.ctx.emit('context-debt/scan', scan)
    return scan
  }

  /**
   * Produce a fold-only compaction plan for a session: `foldSummary` over the
   * committed events → summary; the shadowed range is the stuffed span (the
   * whole committed range when nothing is stuffed); shadowedSeqs and count
   * come from the same span; `foldOnly` is ALWAYS `true`. The plan is a
   * derived value — the log is never rewritten.
   *
   * @param session - the live session; its frozen committed snapshot is read.
   * @param budgetTokens - the summary token budget for the fold.
   * @returns the fold-only plan; `isFoldOnly(plan, lastCommittedSeq)` holds.
   * @throws {Error} When the service is disabled (`'context-debt disabled'`).
   * @emits context-debt/plan
   */
  plan(session: Session, budgetTokens: number): CompactionPlan {
    if (!this.enabled) {
      throw new Error('context-debt disabled')
    }
    const events = session.events
    const summary = foldSummary(events, budgetTokens)
    const span = stuffedSpan(events, this.stuffedThresholdTokens)
    const shadowedRange = span
      ? { start: span.start, end: span.end }
      : events.length === 0
        ? { start: 0, end: -1 }
        : { start: (events[0] as { seq: number }).seq, end: (events[events.length - 1] as { seq: number }).seq }
    const shadowedSeqs = span ? span.seqs : events.map(event => event.seq)
    const shadowedTokenCount = span
      ? span.tokenCount
      : events.reduce((sum, event) => sum + estimateTokens(extractEventText(event)), 0)
    const plan: CompactionPlan = {
      sessionId: session.id,
      summary,
      shadowedRange,
      shadowedSeqs,
      shadowedTokenCount,
      foldOnly: true,
    }
    this.ctx.emit('context-debt/plan', plan)
    return plan
  }

  /**
   * One-line report string for a plan, for observability and accounting.
   *
   * @param plan - the plan to describe.
   * @returns a single-line, deterministic description of the plan.
   */
  report(plan: CompactionPlan): string {
    return [
      `context-debt session=${plan.sessionId}`,
      `fold-only summary=${estimateTokens(plan.summary)}t`,
      `shadowed=${plan.shadowedRange.start}..${plan.shadowedRange.end}`,
      `seqs=${plan.shadowedSeqs.length}`,
      `tokens=${plan.shadowedTokenCount}`,
    ].join(' ')
  }

  /**
   * Split a plan's summary into the critical head and tail bands per
   * positional placement: leading lines fill the head band up to the
   * configured head token budget, trailing lines fill the tail band up to the
   * configured tail token budget, and the middle is dropped — critical
   * context lands at head/tail. Assembly of the actual model-visible context
   * from these bands is the caller's wiring.
   *
   * @param plan - the plan whose summary is split.
   * @returns the head and tail band line arrays (deterministic order).
   */
  reposition(plan: CompactionPlan): { head: string[]; tail: string[] } {
    const lines = plan.summary.split('\n').filter(line => line.length > 0)
    const head: string[] = []
    const tail: string[] = []
    let headTokens = 0
    for (const line of lines) {
      const cost = estimateTokens(line)
      if (headTokens + cost > this.positionalHeadTokens) break
      head.push(line)
      headTokens += cost
    }
    let tailTokens = 0
    for (let index = lines.length - 1; index >= head.length; index--) {
      const line = lines[index] as string
      const cost = estimateTokens(line)
      if (tailTokens + cost > this.positionalTailTokens) break
      tail.unshift(line)
      tailTokens += cost
    }
    return { head, tail }
  }
}

export default ContextDebtService

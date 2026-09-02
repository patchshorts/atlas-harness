/**
 * @atlasai/atsh-session-context-debt — pure fold functions.
 *
 * Every function here is deterministic, has no I/O, and never touches the
 * session log: they read committed {@link SessionEvent}s and return derived
 * values. The JSONL log stays byte-identical after any fold. Reports
 * produced by pure folds carry `sessionId: ''` — the fold has no session
 * identity; the service fills it from the live session.
 */

import type { SessionEvent } from '@atlasai/atsh-session'
import type { CompactionPlan, ContextDebtReport } from './types.ts'

/** Deterministic token heuristic: 4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Event types that carry essential conversation content. Everything else
 * (`tool/result`, `assistant/chunk`, usage and lifecycle records) counts as
 * non-essential context — the stuff that accumulates into debt.
 */
const ESSENTIAL_TYPES = new Set(['turn/start', 'turn/end', 'user/message', 'assistant/message'])

/** Whether an event carries non-essential context (tool results, verbatim logs). */
function isNonEssential(event: SessionEvent): boolean {
  return !ESSENTIAL_TYPES.has(event.type)
}

/**
 * Recursively collect every `text` string reachable through `content` /
 * `text` fields (depth-bounded by the data shape itself; tool-result blocks
 * nest their content one level deeper than message blocks).
 */
function extractTextFrom(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return ''
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const item of value) {
      const text = extractTextFrom(item)
      if (text.length > 0) parts.push(text)
    }
    return parts.join('\n')
  }
  const record = value as Record<string, unknown>
  const text = record.text
  if (typeof text === 'string' && text.length > 0) return text
  return extractTextFrom(record.content)
}

/**
 * Extract the human-readable text carried by one event (`''` when the event
 * carries none). Reads `data.message.content` / `data.content` text blocks
 * recursively — never mutates anything.
 *
 * @param event - the committed event to read.
 * @returns the extracted text, `''` when the event has no readable content.
 */
export function extractEventText(event: SessionEvent): string {
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null) return ''
  const record = data as Record<string, unknown>
  const message: unknown = record.message ?? record
  if (typeof message !== 'object' || message === null) return ''
  return extractTextFrom(message)
}

/**
 * The stuffed span of a log: every non-essential event that carries text,
 * with its seqs and estimated token count. Returns `null` when the
 * accumulated non-essential context does not exceed `thresholdTokens`.
 *
 * @param events - the committed events to fold over.
 * @param thresholdTokens - accumulated non-essential tokens that trigger a span.
 * @returns the span, or `null` when the log is not stuffed past the threshold.
 */
export function stuffedSpan(
  events: readonly SessionEvent[],
  thresholdTokens: number,
): { start: number; end: number; seqs: number[]; tokenCount: number } | null {
  const seqs: number[] = []
  let tokens = 0
  for (const event of events) {
    if (!isNonEssential(event)) continue
    const text = extractEventText(event)
    if (text === '') continue
    const cost = estimateTokens(text)
    if (cost === 0) continue
    seqs.push(event.seq)
    tokens += cost
  }
  if (seqs.length === 0 || tokens <= thresholdTokens) return null
  return { start: seqs[0] as number, end: seqs[seqs.length - 1] as number, seqs, tokenCount: tokens }
}

/**
 * Deterministic fold over committed events → summary text. Walks events in
 * seq order, appends one `[seq N] type: text` line per content-bearing event,
 * and stops (or truncates a line) so the estimated content never exceeds
 * `budgetTokens`. Returns `''` for an empty log or a non-positive budget.
 * Pure: the ONLY summary producer in this package.
 *
 * @param events - the committed events to fold.
 * @param budgetTokens - the token budget the summary must stay within.
 * @returns the derived summary text, never more than `budgetTokens`.
 */
export function foldSummary(events: readonly SessionEvent[], budgetTokens: number): string {
  if (budgetTokens <= 0 || events.length === 0) return ''
  const lines: string[] = []
  let used = 0
  for (const event of events) {
    const text = extractEventText(event)
    if (text === '') continue
    const prefix = `[seq ${event.seq}] ${event.type}: `
    const prefixCost = estimateTokens(prefix)
    let body = text
    let bodyCost = estimateTokens(body)
    if (used + prefixCost + bodyCost > budgetTokens) {
      const remaining = Math.max(0, budgetTokens - used - prefixCost)
      if (remaining <= 0) break
      body = body.slice(0, remaining * 4)
      bodyCost = estimateTokens(body)
      if (bodyCost === 0) break
    }
    lines.push(prefix + body)
    used += prefixCost + bodyCost
  }
  return lines.join('\n')
}

/**
 * Detect stuffed context: a `'stuffed'` report when accumulated non-essential
 * context (tool results, verbatim logs) exceeds `thresholdTokens`.
 *
 * @param events - the committed events to scan.
 * @param thresholdTokens - the stuffed threshold.
 * @returns a `'stuffed'` report (`sessionId: ''` — the fold has no session
 *   identity) or `null` when the log is not stuffed.
 */
export function detectStuffedContext(
  events: readonly SessionEvent[],
  thresholdTokens: number,
): ContextDebtReport | null {
  const span = stuffedSpan(events, thresholdTokens)
  if (!span) return null
  return {
    sessionId: '',
    kind: 'stuffed',
    measure: span.tokenCount,
    detail: `non-essential context (tool results, verbatim logs) accumulates ${span.tokenCount} tokens across seqs ${span.start}..${span.end}`,
  }
}

/**
 * Positional placement: report which content-bearing events sit outside the
 * critical head/tail bands. The head band fills from the log start up to
 * `headTokens`; the tail band fills from the log end up to `tailTokens`;
 * every content-bearing event in the middle produces one `'positioned'`
 * report. Critical context belongs at head/tail — middle placement is debt.
 *
 * @param events - the committed events to scan.
 * @param headTokens - the head band token budget.
 * @param tailTokens - the tail band token budget.
 * @returns one `'positioned'` report per middle content-bearing event
 *   (`sessionId: ''` — the fold has no session identity).
 */
export function positionalPlacement(
  events: readonly SessionEvent[],
  headTokens: number,
  tailTokens: number,
): ContextDebtReport[] {
  if (events.length === 0) return []
  const headSeqs = new Set<number>()
  let headUsed = 0
  for (const event of events) {
    const text = extractEventText(event)
    if (text === '') continue
    const cost = estimateTokens(text)
    if (headUsed + cost > headTokens) break
    headUsed += cost
    headSeqs.add(event.seq)
  }
  const tailSeqs = new Set<number>()
  let tailUsed = 0
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index] as SessionEvent
    const text = extractEventText(event)
    if (text === '') continue
    const cost = estimateTokens(text)
    if (tailUsed + cost > tailTokens) break
    tailUsed += cost
    tailSeqs.add(event.seq)
  }
  const reports: ContextDebtReport[] = []
  for (const event of events) {
    if (headSeqs.has(event.seq) || tailSeqs.has(event.seq)) continue
    const text = extractEventText(event)
    if (text === '') continue
    reports.push({
      sessionId: '',
      kind: 'positioned',
      measure: estimateTokens(text),
      detail: `seq ${event.seq} (${event.type}) sits outside the head/tail bands`,
    })
  }
  return reports
}

/**
 * Assert a plan is fold-only: `foldOnly === true`, a non-empty summary, an
 * integer non-degenerate shadowed range, and shadowed seqs that all fall
 * inside that range. When `lastCommittedSeq` is given, every shadowed seq
 * must also reference a committed event (no invented seqs).
 *
 * @param plan - the plan to validate.
 * @param lastCommittedSeq - optional last committed seq of the source log;
 *   rejects plans that shadow invented (uncommitted) seqs.
 * @returns `true` when the plan is a valid fold-only plan.
 */
export function isFoldOnly(plan: CompactionPlan, lastCommittedSeq?: number): boolean {
  // casters can forge foldOnly:false; runtime must reject (spec proves the cast)
  // oxlint-disable-next-line typescript/no-unnecessary-boolean-literal-compare, typescript/no-unnecessary-condition
  if (plan.foldOnly !== true) return false
  if (typeof plan.summary !== 'string' || plan.summary.length === 0) return false
  const { start, end } = plan.shadowedRange
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return false
  if (!Array.isArray(plan.shadowedSeqs) || plan.shadowedSeqs.length === 0) return false
  for (const seq of plan.shadowedSeqs) {
    if (!Number.isInteger(seq) || seq < start || seq > end) return false
    if (lastCommittedSeq !== undefined && seq > lastCommittedSeq) return false
  }
  return true
}

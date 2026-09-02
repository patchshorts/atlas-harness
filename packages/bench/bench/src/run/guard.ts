/**
 * `bench-loop-guard` — function plugin that wires the corrections-study loop
 * guard into the bench preset.
 *
 * Composes three guard mechanisms so a benchmark session cannot grind to a
 * wasteful blow-up (the hrd-02 61→280 / rv-18 19→82 failures):
 *
 * 1. **Hard per-task call ceiling** — counts `tools/execute` calls and vetoes
 *    every call once the ceiling is reached (the structural over-run stop).
 * 2. **D4 accounting cap hook** — reads the optional `ctx.accounting` budget
 *    (`ctx.get('accounting')`, the budget-router precedent) and stops the
 *    session when the account spend is at/over its configured cap.
 * 3. **D6 repeated-call / P-Ratio fold** — folds the REAL alarm detectors
 *    (`detectRepeatedCalls`, `detectPRatio` from
 *    `@atlasai/atsh-runtime-alarms`) over the observed runtime event stream
 *    and escalates a critical alarm into the same veto.
 *
 * Every stop funnels to a single `BUDGET_EXCEEDED` veto at the `tools/execute`
 * boundary (returns an `isError` result WITHOUT calling `next()` — the tool
 * never runs) and emits `bench/guard-veto` naming which guard tripped. Because
 * the veto is sticky, no tool can ever execute again after the first stop, so
 * the ONLY way the session concludes is the "summarize & submit" fallback
 *: the vetoed result embeds a directive telling the model to stop
 * calling tools and write a final summary — producing the fallback summary
 * event in the session log instead of a silent wall-clock hang.
 *
 * Golden rule: the guard never reads, writes, or mutates model-visible history.
 * It vetoes at the tool boundary and emits a diagnostic event only. The plugin
 * is an ADD (packages/bench); it never touches a frozen upstream file. The
 * decision layer is a pure function so it is unit-testable without booting the
 * harness (deferred-verification contract — self-targeted fast spec).
 *
 * @module @atlasai/atsh-bench/run/guard
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { detectPRatio, detectRepeatedCalls } from '@atlasai/atsh-runtime-alarms'

export const name = 'bench-loop-guard'

/** Config for the bench loop-guard, validated fail-loud at load. */
export interface Config {
  /** Hard per-task tool-call ceiling (the over-run stop). */
  callCeiling: number
  /** Consecutive identical calls that trip the D6 repeated-call alarm. */
  repeatedCallThreshold?: number
  /** Output-token fraction below which the D6 P-Ratio alarm fires. */
  minOutputFraction?: number
  /**
   * Optional override of the "summarize & submit" directive embedded in every
   * vetoed tool result. Must instruct the model to stop calling
   * tools, write a final summary, and submit. Defaults to the built-in text.
   */
  fallbackDirectiveText?: string
}

export const Config: z<Config> = z.object({
  callCeiling: z.natural().min(1),
  repeatedCallThreshold: z.natural().min(2).default(3),
  minOutputFraction: z.number().min(0).max(1).default(0.15),
  fallbackDirectiveText: z.string().min(1),
})

/** The guard reason that forced a stop (T7 keys its fallback on this). */
export type GuardReason = 'call-ceiling' | 'accounting-cap' | 'repeated-call' | 'p-ratio'

/** Result of evaluating the guard at a tool boundary. */
export interface GuardVerdict {
  /** True when the session MUST stop before dispatching the next call. */
  stop: boolean
  /** Which guard fired (`null` when `stop` is false). */
  reason: GuardReason | null
}

/** Inputs to the pure guard decision. */
export interface GuardVerdictInput {
  /** Tool calls observed so far in the task. */
  toolCalls: number
  /** The configured hard ceiling. */
  callCeiling: number
  /** True when the D4 accounting budget is spent for the account. */
  accountExceeded: boolean
  /** True when the D6 repeated-call detector reached critical. */
  repeatedCallCritical: boolean
  /** True when the D6 P-Ratio detector raised. */
  pRatioRaised: boolean
}

/**
 * The pure, testable guard decision. Harder stops win: the accounting cap is
 * the strongest (the operator's explicit budget knob), then the D6 efficiency
 * alarms, then the structural call ceiling.
 *
 * @param input - the guard inputs.
 * @returns the verdict naming the guard that fired.
 */
export function loopGuardVerdict(input: GuardVerdictInput): GuardVerdict {
  if (input.accountExceeded) return { stop: true, reason: 'accounting-cap' }
  if (input.pRatioRaised) return { stop: true, reason: 'p-ratio' }
  if (input.repeatedCallCritical) return { stop: true, reason: 'repeated-call' }
  if (input.toolCalls >= input.callCeiling) return { stop: true, reason: 'call-ceiling' }
  return { stop: false, reason: null }
}

/**
 * A structural subset of the runtime event the D6 detectors read — only the
 * fields the fold consumes. Kept local so the guard does not need a hard
 * dependency on the runtime-events package.
 */
export interface GuardRuntimeEvent {
  readonly kind: 'tool/call' | 'model/call'
  readonly seq: number
  readonly ts: number
  readonly tool?: string
  readonly model?: string
  readonly inputTokens?: number
  readonly outputTokens?: number
}

/**
 * Fold the D6 alarm detectors over a runtime event stream. Recombines the REAL
 * `detectRepeatedCalls` / `detectPRatio` detectors (an existing subsystem, not
 * a re-implementation) over the events the guard observed. Returns a verdict:
 * stop with `repeated-call` when a repeated run escalates to critical, stop
 * with `p-ratio` on an efficiency collapse.
 *
 * @param events - tool/model events observed by the guard (in seq order).
 * @param options - detector tuning.
 * @returns the guard verdict for the event fold.
 */
export function foldGuard6M(
  events: readonly GuardRuntimeEvent[],
  options: { repeatedCallThreshold?: number; minOutputFraction?: number } = {},
): GuardVerdict {
  const asRuntime = events as unknown as Parameters<typeof detectRepeatedCalls>[0]
  const repeatedOpts = options.repeatedCallThreshold === undefined
    ? {} : { repeatThreshold: options.repeatedCallThreshold }
  const pRatioOpts = options.minOutputFraction === undefined
    ? {} : { minOutputFraction: options.minOutputFraction }
  const repeated = detectRepeatedCalls(asRuntime, repeatedOpts)
  const pRatio = detectPRatio(asRuntime, pRatioOpts)
  if (pRatio.length > 0) return { stop: true, reason: 'p-ratio' }
  if (repeated.some(alarm => alarm.severity === 'critical')) return { stop: true, reason: 'repeated-call' }
  return { stop: false, reason: null }
}

/** One vetoed tool result (mirrors AccountingService.guardTool's shape). */
export interface ToolResult {
  content: Array<{ type: string; text: string }>
  isError: boolean
  error?: { message: string; info: { name: string; code: string } }
}

/** Shared error-code for every guard stop (classifier + T7 key on this). */
export const VETO_CODE = 'BUDGET_EXCEEDED'

/**
 * Graded guard tiers. The guard is a
 * ladder, not a cliff: below the hard ceiling the session keeps running but the
 * model receives escalating advisory directives. Only the 100% tier vetoes.
 */
export type GuardTier =
  | 're-read-contract' // 40% — re-read the task contract before continuing
  | 'force-plan-recheck' // 65% — next call must be a contract or test read
  | 'model-escalate' // 85% — escalate model tier via the router (if configured)
  | 'veto' // 100% — BUDGET_EXCEEDED veto + summarise-and-submit

/** Tier-boundary thresholds as a fraction of the configured call ceiling. */
export const GUARD_TIER_RATIOS = {
  reRead: 0.4,
  planRecheck: 0.65,
  escalate: 0.85,
  veto: 1.0,
} as const

/** Decision that fires the highest graded tier at-or-below the current ratio. */
export interface GuardTierDecision {
  /** The highest tier whose threshold the current call ratio has reached. */
  tier: GuardTier | null
  /** toolCalls / callCeiling (1.0 when at/over the ceiling). */
  ratio: number
  /** The advisory directive to inject into the tool result (null below any tier). */
  directive: string | null
}

/** Default directive text injected at the re-read-contract tier. */
export const RE_READ_CONTRACT_DIRECTIVE =
  'Graded guard (40% of ceiling): re-read the task contract before continuing. ' +
  'Confirm the current step still matches the requested change.'

/** Default directive text injected at the force-plan-re-check tier. */
export const FORCE_PLAN_RECHECK_DIRECTIVE =
  'Graded guard (65% of ceiling): force a plan re-check. ' +
  'The next call MUST be a read of the contract or a test, not another edit.'

/** Default directive text injected at the model-escalation tier. */
export const MODEL_ESCALATE_DIRECTIVE =
  'Graded guard (85% of ceiling): escalating model tier via the router (if configured). ' +
  'If no router tier switch is available, hold current tier and continue carefully.'

/**
 * The pure, testable graded-tier decision. Given how many tool calls have run
 * and the configured ceiling, decide which advisory tier (if any) fires.
 * Returns `null` below the 40% threshold — the guard stays silent there.
 *
 * It is PURE: no mutation, no reads of model-visible history. The 100% tier
 * returns `veto` so the existing `loopGuardVerdict` / `guardVetoResult` stop
 * path (with its summarize-and-submit fallback) remains the terminal action.
 *
 * @param toolCalls - tool calls observed so far.
 * @param callCeiling - the configured per-task call ceiling.
 * @returns the tier decision (may be a no-op `tier: null`).
 */
export function guardTierDecision(callCount: number, callCeiling: number): GuardTierDecision {
  const ratio = callCeiling <= 0 ? 0 : callCount / callCeiling
  const tiers: Array<{ ratio: number; tier: GuardTier; directive: string }> = [
    { ratio: GUARD_TIER_RATIOS.veto, tier: 'veto', directive: DEFAULT_FALLBACK_DIRECTIVE },
    { ratio: GUARD_TIER_RATIOS.escalate, tier: 'model-escalate', directive: MODEL_ESCALATE_DIRECTIVE },
    { ratio: GUARD_TIER_RATIOS.planRecheck, tier: 'force-plan-recheck', directive: FORCE_PLAN_RECHECK_DIRECTIVE },
    { ratio: GUARD_TIER_RATIOS.reRead, tier: 're-read-contract', directive: RE_READ_CONTRACT_DIRECTIVE },
  ]
  for (const t of tiers) {
    if (ratio >= t.ratio) return { tier: t.tier, ratio, directive: t.directive }
  }
  return { tier: null, ratio, directive: null }
}

/**
 * Append a graded-tier directive to an existing tool result so the model
 * observes the advisory without mutating the original result's shape. Returns
 * a NEW result object; the input is untouched. If the input is already an
 * isError result, the directive is appended to its content unchanged.
 */
export function appendTierDirective(
  result: ToolResult,
  directive: string,
): ToolResult {
  const content = Array.isArray(result.content)
    ? [...result.content, { type: 'text', text: directive }]
    : [{ type: 'text', text: directive }]
  return { ...result, content }
}

/**
 * The built-in "summarize & submit" fallback directive.
 *
 * Embedded in every vetoed tool result. Because the veto is STICKY for the
 * session (no tool can execute again after the first veto), the ONLY way the
 * model can conclude is to emit a no-tool-call final assistant/message — which
 * is exactly this directive's instruction. The agent loop returns
 * {kind:'completed'} on that message, so the final summary IS the fallback
 * summary event in the session log; the session never hangs against the
 * 30-minute wall clock.
 */
export const DEFAULT_FALLBACK_DIRECTIVE =
  'Bench loop-guard stopped this session (per-task call ceiling reached). ' +
  'You must NOT call any more tools — every further call will be rejected. ' +
  'Immediately write a concise final summary of what you completed (and what ' +
  'remains, if any), STOP, and submit that summary as your final answer.'

/**
 * Build the vetoed tool result that forces the "summarize & submit" fallback.
 *
 * A pure builder so the fallback directive is unit-testable without booting
 * the harness (deferred-verification contract — self-targeted fast spec). The
 * result is an `isError` tool result that NEVER calls the next tool: the model
 * receives the directive, and the sticky veto guarantees no tool can run
 * afterwards, mechanically cornering the session into a clean submit rather
 * than a silent wall-clock hang.
 *
 * @param reason - the guard reason that forced the stop.
 * @param count - tool calls observed before the stop.
 * @param ceiling - the configured per-task call ceiling.
 * @param directive - optional override of the fallback directive text.
 * @returns the vetoed tool result carrying the summarize & submit directive.
 */
export function guardVetoResult(
  reason: GuardReason,
  count: number,
  ceiling: number,
  directive: string = DEFAULT_FALLBACK_DIRECTIVE,
): ToolResult {
  const message = `bench loop-guard stopped the session (${reason}) after ${count} tool calls (ceiling ${ceiling}).`
  return {
    content: [{ type: 'text', text: `Error: ${message}\n\n${directive}` }],
    isError: true,
    error: { message, info: { name: 'BudgetExceededError', code: VETO_CODE } },
  }
}

/** Minimal view of the `tools/execute` payload the guard reads. */
interface ToolExec {
  name?: string
  agent?: { id: string }
}

/** Minimal view of the optional accounting service (budget-router precedent). */
interface AccountingLike {
  budgets?: Record<string, number>
  spendFor?: (account: string) => number
}

/** Minimal view of an `llm/stream` chunk the guard folds (any chunk kind). */
interface LLMUsageChunk {
  type: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Diagnostic emitted when a guard stops the session. Carries the reason,
     * observed call count, ceiling, and the summarize & submit directive the
     * vetoed tool result embeds — the fallback a downstream log
     * consumer can observe.
     * @param event - the guard-veto payload.
     * @param event.reason - why the guard stopped the session.
     * @param event.count - observed call count.
     * @param event.ceiling - the per-task ceiling that was exceeded.
     * @param event.ts - emission timestamp (epoch ms).
     * @param event.directive - the summarize-and-submit fallback directive.
     * @mode emit
     */
    'bench/guard-veto'(
      event: {
        reason: GuardReason
        count: number
        ceiling: number
        ts: number
        directive?: string
      },
    ): void
  }
}

/**
 * Install the guard's listeners on a plugin context. The harness mounts this
 * plugin via the bench home patch; listeners are disposed with the owning
 * context.
 *
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const { callCeiling } = config
  const repeatedThreshold = config.repeatedCallThreshold as number
  const minFraction = config.minOutputFraction as number
  const directive = config.fallbackDirectiveText ?? DEFAULT_FALLBACK_DIRECTIVE

  let calls = 0
  let seq = 0
  // A stop is sticky for the session: once a guard fires, every later call is
  // vetoed so the run cannot resume grinding after the first veto.
  let stopped: GuardReason | null = null
  // The most-recently fired graded tier. Each ladder step emits
  // its directive ONCE, when its threshold is first crossed — not on every
  // subsequent call above the ratio.
  let firedTier: GuardTier | null = null
  const events: GuardRuntimeEvent[] = []

  // Hook the organic harness waterfalls WITHOUT touching the shared cordis
  // Events interface (their real signatures live in dsh-llm/dsh-tools; a
  // competing augmentation breaks `ctx.on` across the whole workspace). The
  // narrow cast keeps this additive package dependency-light and non-clashing.
  // `any` is contained to the listener args so callers keep their concrete
  // event shapes without widening the shared Events map.
  const hook = ctx.on as unknown as (
    event: string,
    listener: (...args: any[]) => any,
  ) => unknown

  /** D4 accounting-cap hook: true when the optional `ctx.accounting` budget is spent. */
  const accountExceeded = (): boolean => {
    const accounting = ctx.get('accounting') as AccountingLike | undefined
    const cap = accounting?.budgets?.default
    if (cap === undefined) return false
    return (accounting?.spendFor?.('default') ?? 0) >= cap
  }

  // Emit the diagnostic the fallback (T7) consumes; never model-visible.
  const emitVeto = (reason: GuardReason, count: number): void => {
    ctx.emit('bench/guard-veto', { reason, count, ceiling: callCeiling, ts: Date.now(), directive })
  }

  hook('tools/execute', (exec: ToolExec, next: () => Promise<unknown>) => {
    if (stopped !== null) {
      emitVeto(stopped, calls)
      return Promise.resolve(guardVetoResult(stopped, calls, callCeiling, directive))
    }
    calls += 1
    seq += 1
    events.push({
      kind: 'tool/call',
      seq,
      ts: Date.now(),
      ...(exec.name === undefined ? {} : { tool: exec.name }),
    })

    const d6 = foldGuard6M(events, {
      repeatedCallThreshold: repeatedThreshold,
      minOutputFraction: minFraction,
    })
    const verdict = d6.stop
      ? d6
      : loopGuardVerdict({
        toolCalls: calls,
        callCeiling,
        accountExceeded: accountExceeded(),
        repeatedCallCritical: false,
        pRatioRaised: false,
      })
    if (verdict.stop) {
      const reason = verdict.reason as GuardReason
      stopped = reason
      emitVeto(reason, calls)
      return Promise.resolve(guardVetoResult(reason, calls, callCeiling, directive))
    }

    // Graded-tier advisory: when the call ratio crosses a ladder
    // threshold but has NOT reached the veto ceiling, append the tier's
    // directive to the tool result so the model observes the escalation
    // guidance. The tool STILL RUNS (the advisory is not a stop) — `next()` is
    // awaited and the directive is appended to its real content. History is
    // never written by the guard; only a diagnostic event is emitted.
    const tiered = guardTierDecision(calls, callCeiling)
    if (
      tiered.tier !== null &&
      tiered.directive !== null &&
      tiered.tier !== firedTier &&
      tiered.tier !== 'veto'
    ) {
      firedTier = tiered.tier
      ctx.emit('bench/guard-veto', {
        reason: tiered.tier as unknown as GuardReason,
        count: calls,
        ceiling: callCeiling,
        ts: Date.now(),
        directive: `[graded-guard:${tiered.tier}] ${tiered.directive}`,
      })
      return next().then(result => appendTierDirective(
        result as ToolResult,
        `[graded-tier:${tiered.tier}] ${tiered.directive}`,
      ))
    }

    return next()
  })

  // Fold model-call usage so the D6 P-Ratio detector has token signal.
  hook('llm/stream', (options: { model?: string }, next: () => AsyncIterable<LLMUsageChunk>) => {
    return (async function * wrapped(): AsyncGenerator<LLMUsageChunk> {
      let usage: LLMUsageChunk['usage']
      try {
        const source = next()
        for await (const chunk of source) {
          if (chunk.type === 'usage' && chunk.usage !== undefined) usage = chunk.usage
          yield chunk
        }
      } finally {
        if (usage !== undefined) {
          seq += 1
          events.push({
            kind: 'model/call',
            seq,
            ts: Date.now(),
            ...(options.model === undefined ? {} : { model: options.model }),
            ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
            ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
          })
        }
      }
    })()
  })
}

export default { name, Config, apply }

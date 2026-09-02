/**
 * `bench-tripwire` — function plugin that wires the plan-vs-actual cost
 * tripwire into the bench preset.
 *
 * Plan admission REQUIRES an estimated tool-call count. When a plan is
 * admitted (the bench task carries a plan estimate), this plugin watches the
 * ACTUAL tool-call count as the session executes and compares it against the
 * plan's predicted count. When actual > `tripRatio` (default 3) x predicted —
 * the hrd-02 61→280 / rv-18 19→82 blow-up shape — it emits a
 * `bench/tripwire-alarm` and forces a STICKY checkpoint-and-replan veto at the
 * `tools/execute` boundary: the model must stop, checkpoint its state (the
 * session log IS the checkpoint, D9), and REVISE the plan with a corrected
 * estimate before any further tool call. This is the inventive reuse of the
 * plan-admission estimate (packages/plan), the accounting spend read
 * (packages/accounting), and the runtime-alarms detector vocabulary
 * (packages/runtime-diagnostics/observability) recombined into ONE guard that
 * provably would have caught the worst failures rather than plausibly helping.
 *
 * Golden rule: the tripwire never reads, writes, or mutates model-visible
 * history. It vetoes at the tool boundary and emits a diagnostic event only.
 * The plugin is an ADD (packages/bench); it never touches a frozen upstream
 * file. The decision layer is a pure function so it is unit-testable without
 * booting the harness (deferred-verification contract — self-targeted fast
 * spec).
 *
 * @module @atlasai/atsh-bench/run/tripwire
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'bench-tripwire'

/** Config for the bench plan-vs-actual tripwire, validated fail-loud at load. */
export interface Config {
  /**
   * The plan's estimated tool-call count, required at plan admission. Loading
   * the plugin without a positive estimate FAILS LOUD — a plan admission that
   * carries no estimate cannot be watched, and that is itself a signal the
   * plan was never costed.
   */
  planEstimatedToolCalls: number
  /** Actual-to-predicted ratio that trips the alarm (default 3). */
  tripRatio?: number
  /**
   * Optional override of the checkpoint-and-replan directive embedded in
   * every vetoed tool result. Must instruct the model to stop calling tools,
   * checkpoint its state, and REVISE the plan with a corrected estimate.
   * Defaults to the built-in text.
   */
  checkpointDirectiveText?: string
}

export const Config: z<Config> = z.object({
  planEstimatedToolCalls: z.natural().min(1),
  tripRatio: z.number().min(1).default(3),
  checkpointDirectiveText: z.string().min(1),
})

/** The tripwire's stop reason (a single, distinct reason). */
export type TripwireReason = 'plan-vs-actual'

/** Result of evaluating the tripwire at a tool boundary. */
export interface TripwireVerdict {
  /** True when the session MUST stop before dispatching the next call. */
  stop: boolean
  /** Which guard fired (`null` when `stop` is false). */
  reason: TripwireReason | null
}

/** Inputs to the pure tripwire decision. */
export interface TripwireVerdictInput {
  /** The plan's predicted tool-call count (the admission estimate). */
  predicted: number
  /** Tool calls actually observed so far in the session. */
  actual: number
  /** Actual-to-predicted ratio that trips (default 3). */
  ratio?: number
}

/**
 * The pure, testable tripwire decision. Actual tool calls exceed the plan's
 * predicted count by more than `ratio` (default 3x) → the plan is
 * over-budget and the session must checkpoint-and-replan. A non-positive
 * predicted count never trips (no estimate → the admission gate would have
 * already failed loud on mount).
 *
 * @param input - the tripwire inputs.
 * @returns the verdict naming the reason when tripped.
 */
export function tripwireVerdict(input: TripwireVerdictInput): TripwireVerdict {
  const ratio = input.ratio ?? 3
  if (input.predicted > 0 && input.actual > ratio * input.predicted) {
    return { stop: true, reason: 'plan-vs-actual' }
  }
  return { stop: false, reason: null }
}

/** A structural subset of the tool result the veto returns (mirrors the guard's vetoed result). */
export interface ToolResult {
  content: Array<{ type: string; text: string }>
  isError: boolean
  error?: { message: string; info: { name: string; code: string } }
}

/** Shared error-code for the checkpoint-and-replan veto (downstream keys on this). */
const VETO_CODE = 'PLAN_VS_ACTUAL_TRIPPED'

/**
 * The built-in checkpoint-and-replan directive.
 *
 * Distinct from the T7 "summarize & submit" fallback: the tripwire's stop is a
 * CHECKPOINT-AND-REPLAN, not a terminal submit. The model stops calling tools,
 * checkpoints its state (the session log is the durable checkpoint, D4), and
 * REVISES the plan with a corrected estimate. State is preserved; the plan is
 * re-counted. Because the veto is STICKY, no tool can run again until the model
 * submits the revised plan — the session never hangs against the wall clock.
 */
export const DEFAULT_CHECKPOINT_DIRECTIVE =
  'Plan-vs-actual tripwire stopped this session (actual tool calls exceed the ' +
  "plan's estimate by more than 3x). You must NOT call any more tools — every " +
  'further call will be rejected. CHECKPOINT your state now (what you completed, ' +
  'what remains). Then REVISE the plan with a corrected tool-call estimate and ' +
  'submit the revised plan as your final answer.'

/**
 * Build the vetoed tool result that forces the checkpoint-and-replan path.
 *
 * A pure builder so the checkpoint directive is unit-testable without booting
 * (deferred-verification contract). The result is an `isError` tool result
 * that NEVER calls the next tool; the sticky veto guarantees no tool runs
 * afterwards, mechanically cornering the session into a honest checkpoint and
 * revised plan rather than a silent wall-clock hang.
 *
 * @param reason - the tripwire reason that forced the stop.
 * @param predicted - the plan's estimated tool-call count.
 * @param actual - tool calls observed before the stop.
 * @param ratio - the configured trip ratio.
 * @param directive - optional override of the checkpoint directive text.
 * @returns the vetoed tool result carrying the checkpoint-and-replan directive.
 */
export function tripwireCheckpointResult(
  reason: TripwireReason,
  predicted: number,
  actual: number,
  ratio: number,
  directive: string = DEFAULT_CHECKPOINT_DIRECTIVE,
): ToolResult {
  const message = `bench-tripwire stopped the session (${reason}): ${actual} actual tool calls exceed the plan estimate of ${predicted} by >${ratio}x (>=${ratio * predicted}).`
  return {
    content: [{ type: 'text', text: `Error: ${message}\n\n${directive}` }],
    isError: true,
    error: {
      message,
      info: { name: 'PlanVsActualTrippedError', code: VETO_CODE },
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Diagnostic emitted when the tripwire stops the session. Carries the
     * predicted count, observed actual count, trip ratio, and the
     * checkpoint-and-replan directive the vetoed tool result embeds — the
     * fallback a downstream log consumer can observe.
     * @param event - the tripwire-alarm payload.
     * @param event.predicted - the estimated tool-call count.
     * @param event.actual - the observed tool-call count.
     * @param event.ratio - actual/predicted ratio that tripped the wire.
     * @param event.ts - emission timestamp (epoch ms).
     * @param event.directive - the checkpoint-and-replan fallback directive.
     * @mode emit
     */
    'bench/tripwire-alarm'(
      event: {
        predicted: number
        actual: number
        ratio: number
        ts: number
        directive?: string
      },
    ): void
  }
}

/**
 * Install the tripwire's listeners on a plugin context. The harness mounts
 * this plugin via the bench home patch; listeners are disposed with the owning
 * context.
 *
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const { planEstimatedToolCalls: predicted } = config
  const ratio = config.tripRatio as number
  const directive = config.checkpointDirectiveText ?? DEFAULT_CHECKPOINT_DIRECTIVE

  // Plan admission REQUIRES an estimated tool-call count: loading the tripwire
  // without a positive integer estimate FAILS LOUD. A plan that was never
  // counted cannot be watched, and that is itself the signal the admission
  // gate exists to catch. Fail at mount, before any session runs.
  if (!Number.isInteger(predicted) || predicted <= 0) {
    throw new Error(
      `bench-tripwire: plan admission requires a positive integer estimated tool-call count (got ${predicted})`,
    )
  }

  let calls = 0
  // A stop is sticky for the session: once the tripwire fires, every later
  // call is vetoed so the run cannot resume grinding after the first stop.
  let stopped: TripwireReason | null = null

  // Hook the organic harness waterfalls WITHOUT touching the shared cordis
  // Events interface (their real signatures live in dsh-tools; a competing
  // augmentation breaks `ctx.on` across the whole workspace). The narrow cast
  // keeps this additive package dependency-light and non-clashing. `any` is
  // contained to the listener args so callers keep their concrete event
  // shapes without widening the shared Events map.
  const hook = ctx.on as unknown as (
    event: string,
    listener: (...args: any[]) => any,
  ) => unknown

  const emitAlarm = (actual: number): void => {
    ctx.emit('bench/tripwire-alarm', {
      predicted,
      actual,
      ratio,
      ts: Date.now(),
      directive,
    })
  }

  hook('tools/execute', (_exec: { name?: string }, next: () => Promise<unknown>) => {
    if (stopped !== null) {
      emitAlarm(calls)
      return Promise.resolve(tripwireCheckpointResult(stopped, predicted, calls, ratio, directive))
    }
    calls += 1
    const verdict = tripwireVerdict({ predicted, actual: calls, ratio })
    if (verdict.stop) {
      const reason = verdict.reason as TripwireReason
      stopped = reason
      emitAlarm(calls)
      return Promise.resolve(tripwireCheckpointResult(reason, predicted, calls, ratio, directive))
    }
    return next()
  })
}

export default { name, Config, apply }

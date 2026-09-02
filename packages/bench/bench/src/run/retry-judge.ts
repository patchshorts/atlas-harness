/**
 * `bench-retry-judge` — judge-gated retries for the C1-style retry-storm
 *.
 *
 * The C1 correction class (RetriedFailedToolCall, spec §2.1) counts a retried
 * failed tool call: a `tool/result` carrying an error, followed within the
 * window by a `tool/call` of the SAME name. When that retry pattern STORMS —
 * the same tool errors, is retried, errors again, is retried again... — it is
 * the wasted-call shape rv-18 (19→82) and hrd-02 (61→280) exhibit: a
 * stubborn model grinding the exact same failing call instead of pivoting.
 *
 * This plugin routes every about-to-retry through ONE CHEAP FAST-JUDGE — a
 * deterministic decision (`retryJudgeVerdict`) that stops/pivots the session
 * BEFORE the N+1 retry: once a tool has already failed `maxConsecutiveRetries`
 * times in a row, the attempt that would exceed that budget (the N+1 retry)
 * is vetoed at the `tools/execute` boundary with a PIVOT directive telling the
 * model to change zergoing angles instead of blindly retrying the same call.
 *
 * The judge is CHEAP because it is a pure decision over observed failure
 * counts — no LLM re-invocation, no three-panel recomposition — and it is a
 * real stop/pivot: the vetoed `tools/execute` result is an `isError` carrying
 * the pivot directive, so the model receives an explicit instruction to
 * stop/change approach rather than to re-issue the identical call. Because the
 * veto is STICKY (once this tool storms, every FURTHER call of it is vetoed),
 * the ONLY way the session proceeds is a DIRECTED pivot away from the tool.
 *
 * Golden rule: the judge never reads, writes, or mutates model-visible
 * history. It observes `tools/result` errors and vetoes at the
 * `tools/execute` boundary, emitting a diagnostic event only. The plugin is an
 * ADD (packages/bench); it never touches a frozen upstream file. The decision
 * layer is a pure function so it is unit-testable without booting the harness
 * (deferred-verification contract — self-targeted fast spec).
 *
 * @module @atlasai/atsh-bench/run/retry-judge
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'bench-retry-judge'

/**
 * Config for the bench retry judge, validated fail-loud at load.
 * `maxConsecutiveRetries` is the consecutive-FAILURE ceiling: the judge
 * allows a tool to FAIL then RETRY up to this many consecutive times; the
 * NEXT call to the same tool (the N+1 retry) is vetoed.
 */
export interface Config {
  /** Consecutive failed-then-retried executions allowed before a pivot. Default 3. */
  maxConsecutiveRetries?: number
  /**
   * Optional override of the pivot directive embedded in every vetoed tool
   * result. Must instruct the model to STOP retrying this tool and change
   * approach. Defaults to the built-in text.
   */
  pivotDirectiveText?: string
}

export const Config: z<Config> = z.object({
  maxConsecutiveRetries: z.natural().min(1).default(3),
  pivotDirectiveText: z.string().min(1),
})

/** The retry-judge stop reason (a single, distinct reason). */
export type RetryJudgeReason = 'retry-storm'

/** Result of evaluating the retry judge at a tool boundary. */
export interface RetryJudgeVerdict {
  /** True when the session MUST NOT dispatch this retry of the tool. */
  stop: boolean
  /** Which judge rule fired (`null` when `stop` is false). */
  reason: RetryJudgeReason | null
}

/** Inputs to the pure retry-judge decision. */
export interface RetryJudgeVerdictInput {
  /**
   * How many consecutive executions of this tool have already FAILED before
   * the current about-to-run call. A call after `previousFailures` failures
   * is retry #`previousFailures` (first failure → this call is retry #1).
   */
  previousFailures: number
  /** Consecutive-failure ceiling set by the run (maxConsecutiveRetries). */
  maxConsecutive: number
}

/**
 * The pure, testable retry-judge decision. A tool that has ALREADY failed
 * `previousFailures` times consecutively is about to be retried; the judge
 * stops when `previousFailures > maxConsecutive` — the retry AFTER the
 * ceiling, i.e. the (N+1)th retry when maxConsecutive = N. Retries within the
 * ceiling are allowed. The stopper is the storm verdict: the same tool is
 * doomed to keep failing; the pivot must happen now, before the N+1 retry.
 *
 * @param input - the judge inputs.
 * @returns the verdict naming the storm when the next retry must be stopped.
 */
export function retryJudgeVerdict(input: RetryJudgeVerdictInput): RetryJudgeVerdict {
  if (input.previousFailures > input.maxConsecutive) {
    return { stop: true, reason: 'retry-storm' }
  }
  return { stop: false, reason: null }
}

/** A structural subset of the tool result the veto returns (mirrors the guard). */
export interface ToolResult {
  content: Array<{ type: string; text: string }>
  isError: boolean
  error?: { message: string; info: { name: string; code: string } }
}

/** Shared error-code for the pivot veto (downstream logs key on this). */
const VETO_CODE = 'RETRY_STORM_VETOED'

/**
 * The built-in pivot directive.
 *
 * Distinct from the T7 "summarize & submit" fallback and the T13
 * checkpoint-and-replan directive: the retry judge stops ONE tool's endless
 * retry-storm by ordering the model to change approach — a small, surgical
 * redirect, not a terminal submit and not a full replan. The sticky veto
 * guarantees the model cannot blindly re-issue the same failing call.
 */
export const DEFAULT_PIVOT_DIRECTIVE =
  'The judge stopped this retry: this tool has now failed repeatedly and ' +
  'continuing to retry IT will not work. Do NOT call this same tool again — ' +
  'every further call to it will be rejected. PIVOT: change your approach ' +
  '(try a different tool, a different command, or a different step) and ' +
  'continue toward the task from there.'

/**
 * Build the vetoed tool result that pivots the session away from a doomed tool.
 *
 * A pure builder so the pivot directive is unit-testable without booting the
 * harness (deferred-verification contract). The result is an `isError` tool
 * result that NEVER calls the next tool; the sticky veto guarantees the model
 * cannot re-issue this tool again, mechanically forcing a pivot.
 *
 * @param tool - the tool name the retry storm is vetoing.
 * @param previousFailures - consecutive failed executions observed.
 * @param maxConsecutive - the configured ceiling (N; the veto caught the N+1).
 * @param directive - optional override of the pivot directive text.
 * @returns the vetoed tool result carrying the pivot directive.
 */
export function retryJudgePivotResult(
  tool: string,
  previousFailures: number,
  maxConsecutive: number,
  directive: string = DEFAULT_PIVOT_DIRECTIVE,
): ToolResult {
  const message = `bench-retry-judge stopped the retry of "${tool}" (retry-storm: ${previousFailures} prior consecutive failures at ceiling ${maxConsecutive}).`
  return {
    content: [{ type: 'text', text: `Error: ${message}\n\n${directive}` }],
    isError: true,
    error: { message, info: { name: 'RetryStormVetoedError', code: VETO_CODE } },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Diagnostic emitted when the retry judge vetoes a tool retry. Carries
     * the tool, the observed consecutive failures, the ceiling, and the pivot
     * directive the vetoed tool result embeds. Never model-visible.
     * @param event - the retry-judge-veto payload.
     * @param event.tool - the tool whose retry was vetoed.
     * @param event.previousFailures - consecutive failures observed.
     * @param event.maxConsecutive - the ceiling that was exceeded.
     * @param event.ts - emission timestamp (epoch ms).
     * @param event.directive - the pivot directive the vetoed result embeds.
     * @mode emit
     */
    'bench/retry-judge-veto'(
      event: {
        tool: string
        previousFailures: number
        maxConsecutive: number
        ts: number
        directive?: string
      },
    ): void
  }
}

/** Minimal view of the `tools/execute` payload the judge reads. */
interface ToolExec {
  name?: string
  agent?: { id: string }
}

/**
 * Install the retry judge's listeners on a plugin context. The harness mounts
 * this plugin via the bench home patch; listeners are disposed with the
 * owning context. `tools/result` tallies consecutive same-tool failures;
 * `tools/execute` vetoes the N+1 retry.
 *
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const ceiling = config.maxConsecutiveRetries as number
  const directive = config.pivotDirectiveText ?? DEFAULT_PIVOT_DIRECTIVE

  // Consecutive failures per tool name, in session order.
  const failed = new Map<string, number>()
  // A veto is sticky per tool: once a tool is vetoed, every later call of the
  // same tool is rejected so the storm cannot resume by re-invocation.
  const vetoedTools = new Set<string>()

  // Hook the organic harness waterfalls WITHOUT touching the shared cordis
  // Events interface (their real signatures live in dsh-tools; a competing
  // augmentation breaks `ctx.on` across the whole workspace). The narrow cast
  // keeps this additive package dependency-light and non-clashing. `any` is
  // contained to the listener augmentation signatures.
  const hook = ctx.on as unknown as (
    event: string,
    listener: (...args: any[]) => any,
  ) => unknown

  const emitVeto = (tool: string, previousFailures: number): void => {
    ctx.emit('bench/retry-judge-veto', {
      tool,
      previousFailures,
      maxConsecutive: ceiling,
      ts: Date.now(),
      directive,
    })
  }

  // Tally consecutive failures on the RESULT boundary: a tool that errors
  // increments its own failure streak; a success resets it to zero.
  hook('tools/result', (exec: { name?: string }, result: { isError?: boolean }) => {
    if (typeof exec.name !== 'string') return
    if (result.isError === true) {
      failed.set(exec.name, (failed.get(exec.name) ?? 0) + 1)
    } else {
      failed.set(exec.name, 0)
    }
  })

  // Veto at the EXECUTE boundary: an about-to-run retry — a call to a tool
  // that has already failed `ceiling` (or more) consecutive times — is the
  // storm's next should be vetoed BEFORE the call. Direct the model right on
  // the readie pivot.
  hook('tools/execute', (exec: ToolExec, next: () => Promise<unknown>) => {
    if (typeof exec.name !== 'string') return next()
    const tool = exec.name
    if (vetoedTools.has(tool)) {
      emitVeto(tool, failed.get(tool) ?? 0)
      return Promise.resolve(retryJudgePivotResult(tool, failed.get(tool) ?? 0, ceiling, directive))
    }
    const previousFailures = failed.get(tool) ?? 0
    const verdict = retryJudgeVerdict({ previousFailures, maxConsecutive: ceiling })
    if (verdict.stop) {
      vetoedTools.add(tool)
      emitVeto(tool, previousFailures)
      return Promise.resolve(retryJudgePivotResult(tool, previousFailures, ceiling, directive))
    }
    return next()
  })
}

export default { name, Config, apply }

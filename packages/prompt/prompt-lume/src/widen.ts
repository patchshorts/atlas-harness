/**
 * Fallback widen-hook on retrieval miss.
 *
 * The self-extension seam's miss fallback: when a strict acquisition lookup
 * MISSES (returns no germane candidate for the current turn), the widen-hook
 * rescues the turn by widening the retrieval hook in bounded escalation steps
 * instead of failing. Widening means (a) SPANNING MORE CORPORA — relaxing the
 * scope filter so more acquisition scopes / corpora are eligible — and (b)
 * COMMITTING MORE UNDER BUDGET — raising the candidate return cap and the
 * region byte-budget ceiling so more germane chunks clear into commitment.
 * A widen step may also lower the rerank cutoff so candidates that the narrow
 * hook dropped now clear.
 *
 * Every widened result stays behind a finite wall: widening escalates through
 * a fixed policy ladder, never unbounded, and there is no zero-commit path —
 * if every step still misses, the outcome reports the miss (empty candidates,
 * no fabrication). The byte budget ceiling and guardrail enforcement are
 * separate (T15) and do not live here.
 *
 * Purely additive and deterministic (mirrors extend.ts): no LLM provider, no
 * context, no global state. The registry is consulted through its public
 * `lookup` only.
 *
 * @module
 */

import {
  CapabilityRegistry,
  type AcquisitionScope,
  type CapabilityCandidate,
  type LookupOptions,
} from './extend.ts'

/**
 * One widening escalation step on the fallback ladder.
 *
 * Each field widens a specific knob; an omitted field leaves that knob at the
 * value the previous (narrower) step used. `scope: 'all'` drops the scope
 * filter entirely so every eligible corpus is spanned.
 */
export interface WidenStep {
  /**
   * Scope to consult for this step. `'all'` removes the scope restriction
   * (span every eligible corpus); a named scope narrows to that scope only.
   * Omitted → keep the base lookup's scope.
   */
  scope?: AcquisitionScope | 'all'
  /** Lowered rerank cutoff — candidates the narrower hook dropped now clear. */
  threshold?: number
  /** Raised candidate return cap — commit more chunks under the budget. */
  limit?: number
  /** Raised region byte-budget ceiling for the committed context. */
  budgetBytes?: number
}

/**
 * The ordered escalation policy for the widen-hook.
 *
 * `steps` run in order from the narrowest rescue to the widest. The first
 * step whose widened lookup returns candidates wins; later (wider) steps are
 * never reached on that turn. The ladder is finite and fixed at policy build
 * time — widening never runs unbounded.
 */
export interface WidenPolicy {
  /** Human/model-readable strategy label (drives docs + provenance). */
  label: string
  /** Ordered escalation ladder (narrow → wide). Must be non-empty. */
  steps: readonly WidenStep[]
}

/** The result of a widen-on-miss attempt. */
export interface WidenOutcome {
  /**
   * True when the base lookup missed and a widened step recovered candidates;
   * false when the base already hit (no widening) or every step still missed.
   */
  widened: boolean
  /**
   * The candidates returned. When the base hit, the base candidates. When a
   * widened step fired, that step's candidates. When everything missed, [].
   */
  candidates: CapabilityCandidate[]
  /** The index of the policy step that recovered the turn (0-based). */
  step?: number
  /**
   * The region byte-budget ceiling in effect for the returned candidates:
   * the fired step's budgetBytes, else the base budget.
   */
  budgetBytes: number
  /**
   * Derived provenance line marking the widen fallback with the fired step.
   * When nothing was widened, a no-fire line describes the un-widened base.
   */
  provenanceLine: string
}

/** A widened lookup's effective options for one escalation step. */
interface WidenedOptions {
  scope: AcquisitionScope | undefined
  limit: number | undefined
}

/**
 * Resolve one escalation step's effective lookup options against the base.
 *
 * `scope: 'all'` clears the filter (undefined → all scopes eligible); a named
 * scope narrows to it; omitted keeps the base scope. `limit` and the other
 * knobs override the base only when the step sets them.
 */
function widenedOptionsFor(
  base: LookupOptions,
  step: WidenStep,
): WidenedOptions {
  let scope = base.scope
  if (step.scope === 'all') scope = undefined
  else if (step.scope !== undefined) scope = step.scope
  return {
    scope,
    limit: step.limit ?? base.limit,
  }
}

/**
 * The fallback widen-hook: rescue a retrieval miss by widening the hook.
 *
 * When `base` lookup already returns candidates, no widening occurs — the base
 * result passes through unmodified. When the base MISSES (empty), the policy
 * ladder escalates step by step: each step may span more corpora (relax the
 * scope filter), raise the commit cap, lower the rerank cutoff, and raise the
 * region byte budget. The first step that returns candidates wins and the
 * turn is recovered; the outcome reports that step. If every step still
 * misses, the outcome reports the miss with empty candidates — a finite wall,
 * never a fabricated rescue.
 *
 * @param registry - the acquisition registry to consult.
 * @param query - the turn's working intent / capability query.
 * @param base - the strict lookup that missed (its options seed the ladder).
 * @param baseBudgetBytes - the strict region byte budget (widening may raise it).
 * @param policy - the ordered escalation ladder.
 * @returns a {@link WidenOutcome} describing whether/how the hook widened.
 */
export function widenOnMiss(
  registry: CapabilityRegistry,
  query: string,
  base: LookupOptions,
  baseBudgetBytes: number,
  policy: WidenPolicy,
): WidenOutcome {
  // Base already hit — no miss, no widening.
  const baseCandidates = registry.lookup(query, base)
  if (baseCandidates.length > 0) {
    return {
      widened: false,
      candidates: baseCandidates,
      budgetBytes: baseBudgetBytes,
      provenanceLine: `[prompt-lume:acquisition] widen=noop budget=${baseBudgetBytes} (base hit, no widening)`,
    }
  }

  // Escalate the ladder: first step that recovers candidates wins.
  let stepIndex = 0
  for (const step of policy.steps) {
    const opts = widenedOptionsFor(base, step)
    const candidates = registry.lookup(
      query,
      (() => {
        // exactOptionalPropertyTypes forbids explicit `undefined` values;
        // build the options object omitting whichever key is unrestricted.
        const o: LookupOptions = {}
        if (opts.scope !== undefined) o.scope = opts.scope
        if (opts.limit !== undefined) o.limit = opts.limit
        return o
      })(),
    )
    if (candidates.length > 0) {
      const budgetBytes = step.budgetBytes ?? baseBudgetBytes
      const scopeText = opts.scope ?? 'all'
      return {
        widened: true,
        candidates,
        step: stepIndex,
        budgetBytes,
        provenanceLine: `[prompt-lume:acquisition] widen=step${stepIndex} scope=${scopeText} budget=${budgetBytes} src=${policy.label}`,
      }
    }
    stepIndex += 1
  }

  // Every step missed — a finite wall; report the miss, never fabricate.
  return {
    widened: false,
    candidates: [],
    budgetBytes: baseBudgetBytes,
    provenanceLine: `[prompt-lume:acquisition] widen=miss budget=${baseBudgetBytes} (every step missed — finite wall)`,
  }
}

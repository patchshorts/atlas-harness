/**
 * Cost sidecar counters for prompt-lume assembly.
 *
 * @module
 */

/**
 * Fixed text-density heuristic for heuristic token pricing, matching the
 * harness token-meter density (4 chars per token) so prompt-lume cost records
 * reconcile with the meter's request-pressure numbers. Zero-dependency local
 * copy — prompt-lume does not depend on the token-meter package.
 */
export const CHARS_PER_TOKEN = 4

/** One per-assemble cost record emitted on `prompt-lume/cost`. */
export interface PromptLumeCostRecord {
  /** Running call ordinal (1-based) across all records this sidecar emitted. */
  readonly callCount: number
  /** Heuristic tokens of the byte-stable core rendered for this call. */
  readonly coreTokens: number
  /** Heuristic tokens of the injected task-aligned region (0 for a core-only call). */
  readonly regionTokens: number
  /** Heuristic tokens of the full assembled prompt (core + region). */
  readonly inputTokens: number
  /**
   * True when this call's rendered core was byte-identical to the previous
   * call's core — the provider prompt-cache read path survived the turn.
   */
  readonly cacheHit: boolean
  /** Configured byte budget for the task-aligned region. */
  readonly budgetBytes: number
  /** Actual bytes of the injected task-aligned region (0 for a core-only call). */
  readonly regionBytes: number
}

/** Cumulative cost-sidecar totals across every recorded call. */
export interface PromptLumeCostSummary {
  /** Total calls recorded. */
  readonly calls: number
  /** Total cache hits (core byte-identical to the prior call). */
  readonly cacheHits: number
  /** Total cache misses (core changed, or the first call). */
  readonly cacheMisses: number
  /** Cumulative heuristic input tokens (core + region) across all calls. */
  readonly totalInputTokens: number
  /** Cumulative heuristic region tokens across all calls. */
  readonly totalRegionTokens: number
  /** Cumulative injected region bytes across all calls. */
  readonly totalRegionBytes: number
}

/** Heuristic token count for text under the fixed density. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Deterministic byte-identity check for the rendered core.
 *
 * Uses raw string comparison (no hash) so cache-hit is exact, not
 * collision-prone — core byte-identity is the #1 prompt-cache gate.
 */
function sameCore(left: string | undefined, right: string): boolean {
  return left !== undefined && left === right
}

/**
 * Pure cumulative counter for per-assemble prompt-lume cost.
 *
 * Owns the running totals and the previous-call core string used for
 * cache-hit detection. The service holds one instance, calls {@link record}
 * after every assembly, and emits the returned record on `prompt-lume/cost`.
 * Never mutates inputs.
 */
export class CostSidecar {
  private calls = 0
  private cacheHits = 0
  private totalInputTokens = 0
  private totalRegionTokens = 0
  private totalRegionBytes = 0
  private lastCore: string | undefined

  /**
   * Record one assembly.
   *
   * @param core - the rendered byte-stable core (unchanged across turns → cache hit).
   * @param region - the injected task-aligned region text ('' for a core-only call).
   * @param budgetBytes - the configured byte budget for the region.
   * @returns the detached immutable record for this call.
   */
  record(core: string, region: string, budgetBytes: number): PromptLumeCostRecord {
    const coreTokens = estimateTokens(core)
    const regionTokens = region.length === 0 ? 0 : estimateTokens(region)
    const cacheHit = sameCore(this.lastCore, core)
    const regionBytes = region.length === 0 ? 0 : Buffer.byteLength(region, 'utf8')

    this.calls += 1
    if (cacheHit) this.cacheHits += 1
    this.totalInputTokens += coreTokens + regionTokens
    this.totalRegionTokens += regionTokens
    this.totalRegionBytes += regionBytes
    this.lastCore = core

    return Object.freeze({
      callCount: this.calls,
      coreTokens,
      regionTokens,
      inputTokens: coreTokens + regionTokens,
      cacheHit,
      budgetBytes,
      regionBytes,
    })
  }

  /** Cumulative totals across every recorded call. */
  summary(): PromptLumeCostSummary {
    return {
      calls: this.calls,
      cacheHits: this.cacheHits,
      cacheMisses: this.calls - this.cacheHits,
      totalInputTokens: this.totalInputTokens,
      totalRegionTokens: this.totalRegionTokens,
      totalRegionBytes: this.totalRegionBytes,
    }
  }
}

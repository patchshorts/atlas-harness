/**
 * `bench-verify-required` — stale-knowledge verification-required bit
 *.
 *
 * The corrections paper's one success regression (res-2-pydantic-v2) is a
 * task whose prompt REQUIRES a live environment check first: "verify the
 * ACTUAL installed pydantic version and its validator semantics, then
 * migrate." If that verify step is ever SERVED from a cache (the harness
 * response cache replaying a completion, so the model "already knows" the
 * version) or skipped via a route rewrite, the migration can proceed against
 * stale knowledge — exactly the failure a short-circuit produces.
 *
 * This plugin puts a HARD verification-required bit on such prompts: the
 * pure classifier {@link staleVerifyVerdict} decides from a pattern list
 * ("verify", "current version", "actual installed") whether the task prompt
 * demands a live upstream read. When it does, the plugin rewrites the
 * `purpose` field of EVERY resolved request on the `agent/request` waterfall
 * (the same seam the bench pin forces model/temperature/maxTokens on) to a
 * DISTINCT verification-only purpose. Because the harness `llm-cache`
 * exactHash keys on `purpose` (dsh-cache service.ts exactHash includes
 * purpose among the canonical subset), a distinct purpose produces a
 * DIFFERENT cache key — a guaranteed cache MISS — so the model is forced to
 * read the real installed version from upstream. A plain re-run keeps the
 * default purpose and still hits the cache.
 *
 * Design mirrors the conservation of the loop-guard (guard.ts, T6) and
 * serve-trace (trace.ts, T8): an additive packages/bench plugin whose
 * decision layer is a PURE function, unit-testable without booting the
 * harness (deferred-verification contract — self-targeted fast spec). Golden
 * rule: the plugin never reads, writes, or mutates model-visible history. It
 * rewrites the request-purpose field only (a routing/hint field the harness
 * uses for cache-keying and budgeting, not a message/system/tool the model
 * sees), and emits a diagnostic event.
 *
 * @module @atlasai/atsh-bench/run/verify
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'bench-verify-required'

/**
 * The default pattern list that marks a task prompt as stale-knowledge
 * verification-required. Order matters for the `matched` report order.
 */
export const STALE_VERIFY_PATTERNS = ['verify', 'current version', 'actual installed'] as const

/**
 * The distinct request `purpose` forced when verification is required. Must
 * differ from the default purpose the run uses, so the llm-cache exactHash
 * (which keys on `purpose`) produces a non-colliding cache key → cache miss →
 * live upstream read of the actual installed version.
 */
export const VERIFICATION_REQUIRED_PURPOSE = 'bench-verify-required'

/** Config for the bench verify-required plugin, validated fail-loud at load. */
export interface Config {
  /**
   * The full task prompt text. The classifier scans this verbatim; absent
   * (e.g. a run not wired with the plugin active) → verification never fires.
   */
  prompt: string
  /**
   * Optional pattern list override. Defaults to
   * {@link STALE_VERIFY_PATTERNS} ("verify", "current version",
   * "actual installed").
   */
  patterns?: string[]
  /**
   * The distinct request purpose forced when verification is required.
   * Defaults to {@link VERIFICATION_REQUIRED_PURPOSE}.
   */
  verificationPurpose?: string
}

export const Config: z<Config> = z.object({
  prompt: z.string(),
  patterns: z.array(z.string()).default([...STALE_VERIFY_PATTERNS]),
  verificationPurpose: z.string().default(VERIFICATION_REQUIRED_PURPOSE),
})

/** The pure classification result. */
export interface VerifyVerdict {
  /** True when the task prompt demands a live upstream read (cache bypassed). */
  verificationRequired: boolean
  /** The patterns that matched the prompt (evidence for the report). */
  matched: string[]
  /**
   * The purpose to force on every request when verification is required, or
   * `null` when not required (leave the run's default purpose → cache stays).
   */
  forcedPurpose: string | null
}

/**
 * The pure decision layer. Case-insensitive substring scan of the task prompt
 * against the pattern list; ANY hit marks verification required.
 *
 * @param prompt - the full task prompt text.
 * @param patterns - pattern literal list to match (default STALE_VERIFY_PATTERNS).
 * @param verificationPurpose - the purpose to force when required.
 * @returns the verdict.
 */
export function staleVerifyVerdict(
  prompt: string,
  patterns: readonly string[] = STALE_VERIFY_PATTERNS,
  verificationPurpose: string = VERIFICATION_REQUIRED_PURPOSE,
): VerifyVerdict {
  const lower = prompt.toLowerCase()
  const matched = patterns.filter(pattern => lower.includes(pattern.toLowerCase()))
  return matched.length > 0
    ? { verificationRequired: true, matched, forcedPurpose: verificationPurpose }
    : { verificationRequired: false, matched: [], forcedPurpose: null }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Diagnostic emitted when the verify-required bit is armed for a session:
     * carries the matched patterns and the forced-purpose value. Never
     * model-visible.
     * @param event - the verify-required payload.
     * @param event.matched - the stale-knowledge patterns that armed the bit.
     * @param event.forcedPurpose - the verification purpose forced for the session.
     * @param event.ts - emission timestamp (epoch ms).
     * @mode emit
     */
    'bench/verify-required'(
      event: {
        matched: string[]
        forcedPurpose: string
        ts: number
      },
    ): void
  }
}

/** The resolved per-request call config (mirrors the pin plugin's shape). */
interface VerifyCallConfig {
  /** Registered provider route. */
  provider?: string
  /** Provider-owned model id. */
  model?: string
  /** Request purpose (cache-key dimension; the field the bit rewrites). */
  purpose?: string
}

/**
 * Install the verify-required listener on a plugin context. Hooks the
 * `agent/request` waterfall (same seam as the pin): when the task prompt is
 * stale-knowledge verification-required, every resolved request's `purpose`
 * is rewritten to the distinct verification purpose — guaranteeing a cache
 * miss (forced live upstream) for the whole session. When not required, the
 * purpose is left untouched so a plain re-run still hits the cache.
 *
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const patterns = config.patterns as readonly string[]
  const purpose = config.verificationPurpose as string
  const verdict = staleVerifyVerdict(config.prompt, patterns, purpose)

  if (!verdict.verificationRequired) return

  // Emit the diagnostic the report reads; never model-visible.
  ctx.emit('bench/verify-required', { matched: verdict.matched, forcedPurpose: purpose, ts: Date.now() })

  const hook = ctx.on.bind(ctx) as unknown as (
    event: string,
    listener: (payload: unknown, next: () => Promise<VerifyCallConfig>) => Promise<VerifyCallConfig>,
  ) => unknown

  hook('agent/request', (_payload: unknown, next: () => Promise<VerifyCallConfig>) => {
    return next().then(call => ({ ...call, purpose }))
  })
}

export default { name, Config, apply }

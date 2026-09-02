/**
 * `bench-pin-request` — function plugin that forces the benchmark's model,
 * temperature, and max-tokens pin on every agent/request in the waterfall.
 *
 * The base bundle's `agent-default-model` row pins provider/model, but
 * temperature is not settable through settings, so the pin is forced at the
 * request waterfall (same seam as `installModelSelection` in
 * packages/core/agent/src/model-selection.ts): every resolved
 * `LlmCallConfig` is spread and the pinned fields override whatever the
 * profile, presets, or settings proposed.
 *
 * Mounted per session via the bench home patch
 * (`<dsh-home>/cordis.patch.yml` insert row, spec §5), so a misbehaving pin
 * can never leak across sessions.
 *
 * @module @atlasai/atsh-bench/run/pin
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** The resolved per-request call config the pin forces — mirrors `LlmCallConfig`. */
export interface BenchPinCallConfig {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
  /** Sampling temperature. */
  temperature?: number
  /** Output cap. */
  maxTokens?: number
  /** Stop sequences. */
  stop?: string[]
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The agent/request waterfall hook: `next()` resolves the proposed
     * request config; listeners may override fields before the request is
     * dispatched. The bench pin forces model/temperature/maxTokens here.
     */
    'agent/request'(payload: { agent: unknown; turn: number; step: number; signal: unknown }, next: () => Promise<BenchPinCallConfig>): Promise<BenchPinCallConfig>
  }
}

/** Stable Cordis plugin name (matches the home-patch insert row id). */
export const name = 'bench-pin-request'

/** No injections: the waterfall listener only needs the plugin's own config. */
export const inject: string[] = []

/** Plugin config: the benchmark pin, validated by the Loader at mount time. */
export interface BenchPinConfig {
  /** Provider-owned model id forced on every resolved request. */
  model: string
  /** Sampling temperature forced on every resolved request (benchmark pin: 0). */
  temperature: number
  /** Output cap forced on every resolved request. */
  maxTokens: number
}

export const Config: z<BenchPinConfig> = z.object({
  model: z.string().required(),
  temperature: z.number().required(),
  maxTokens: z.number().required(),
})

/**
 * Register the waterfall pin. Every resolved config from `next()` is
 * overridden with the pinned fields; all other fields (provider, effort,
 * stop, ...) are preserved.
 *
 * @param ctx - Host context (any scope; the harness mounts this at the host plane).
 * @param config - validated pin config.
 */
export const apply = (ctx: Context, config: BenchPinConfig): void => {
  ctx.on('agent/request', async (_payload, next) => {
    const resolved = await next()
    return {
      ...resolved,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    }
  })
}

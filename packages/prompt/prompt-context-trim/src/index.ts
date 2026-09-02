/**
 * Verbatim context-surface trimming after the cached core.
 *
 * The L4 verbatim trimming layer of the prompt-lume cost-reduction system:
 * prunes the rolling conversation surface by deletion-not-rewrite after the
 * byte-stable core is fixed, so the provider prompt-cache read on the core and
 * the surviving verbatim tail survives across turns. When deletion cannot
 * reach the byte budget (the verbatim floor alone still exceeds it), the
 * service signals the summarization fallback so the caller can condense the
 * pruned head into a checkpoint while keeping the floor tail verbatim.
 *
 * @module @atlasai/atsh-prompt-context-trim
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { trimSurface } from './trim.ts'
import type {
  MeasuredSurfaceLine,
  SurfaceLine,
  TrimOptions,
  TrimResult,
} from './trim.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    promptContextTrim: PromptContextTrimService
  }
}

/** Plugin config for the verbatim context trimmer. */
export interface PromptContextTrimConfig {
  /** Master switch; when off trim() returns the surface unchanged. Default true. */
  enabled?: boolean
  /** Byte threshold: trimming triggers only above this. Default 32_000. */
  thresholdBytes?: number
  /** Byte floor kept verbatim; deletion never cuts below it. Default 8_000. */
  retainFloorBytes?: number
}

/**
 * Register `ctx.promptContextTrim` to trim the conversation surface verbatim
 * after the cached core is fixed.
 *
 * @memberof module:prompts/prompt-context-trim
 */
export class PromptContextTrimService extends Service {
  static inject = ['memoryStore']
  static Config: z<PromptContextTrimConfig> = z.object({
    enabled: z.boolean().default(true),
    thresholdBytes: z.number().default(32_000),
    retainFloorBytes: z.number().default(8_000),
  })

  private readonly enabled: boolean
  private readonly thresholdBytes: number
  private readonly retainFloorBytes: number

  constructor(ctx: Context, config: PromptContextTrimConfig = {}) {
    super(ctx, 'promptContextTrim')
    this.enabled = config.enabled ?? true
    this.thresholdBytes = config.thresholdBytes ?? 32_000
    this.retainFloorBytes = config.retainFloorBytes ?? 8_000
  }

  /**
   * Trim the surface verbatim, honoring the configured budget and floor.
   *
   * When `enabled` is off, or the surface is already within the threshold, the
   * surface is returned unchanged. Never mutates the input.
   *
   * @param surface - the rolling conversation surface, oldest first.
   * @param overrides - per-call budget/floor/measure overrides.
   * @returns the trim outcome.
   */
  trim(
    surface: readonly SurfaceLine[],
    overrides: Partial<TrimOptions> = {},
  ): TrimResult {
    if (!this.enabled) return { kind: 'none', surface: surface as MeasuredSurfaceLine[] }
    return trimSurface(surface, {
      thresholdBytes: overrides.thresholdBytes ?? this.thresholdBytes,
      retainFloorBytes: overrides.retainFloorBytes ?? this.retainFloorBytes,
      ...(overrides.measure !== undefined ? { measure: overrides.measure } : {}),
    })
  }
}

export { trimSurface } from './trim.ts'
export type {
  MeasuredSurfaceLine,
  SurfaceLine,
  TrimOptions,
  TrimResult,
} from './trim.ts'

export default PromptContextTrimService

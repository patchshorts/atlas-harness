/**
 * Bench service seam (`ctx.bench`): the registration point for the bench
 * family — deterministic C1..C5 correction classification, the N-sessions-per-arm
 * runner, and the paired report/stats modules added by later the bench workstream tasks.
 *
 * The seam intentionally carries no behavior yet: it is the package scaffold
 * (ADD-only contract — no frozen upstream file is modified) that later tasks
 * build on. No LLM judgment is used in any bench count; classification is
 * deterministic rules over the exported append-only session log.
 *
 * @module @atlasai/atsh-bench/service
 */

import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    bench: BenchService
  }
}

/**
 * Configuration surface for the bench family, frozen per run:
 * - `lexicon` — the C1..C5 correction-class lexicon (benchmark spec §2.2)
 * - `model` — the pinned model for both arms
 * - `maxTokens` — the per-session generation cap
 * - `prices` — the price sheet (cached/uncached) fixed at run start
 */
export interface BenchConfig {
  lexicon: Record<string, string[]>
  model: string
  maxTokens: number
  prices: Record<string, number>
}

/**
 * The bench service seam's public surface. Registers `ctx.bench` and exposes
 * the frozen per-run configuration for the deterministic C1..C5 correction
 * classification and N-sessions-per-arm runner added by the the bench workstream tasks.
 * Carries no behavior yet — it is the ADD-only scaffold later bench tasks
 * build on; classification stays deterministic rules, never LLM judgment.
 *
 * @memberof module:@atlasai/atsh-bench/service
 */
export class BenchService extends Service {
  static Config: BenchConfig = {
    lexicon: {},
    model: '',
    maxTokens: 8192,
    prices: {},
  }

  config: BenchConfig

  constructor(ctx: Context, config: Partial<BenchConfig> = {}) {
    super(ctx, 'bench')
    this.config = { ...BenchService.Config, ...config }
  }
}

export default BenchService

// Pure pricing for the pinned DeepSeek pro constants — no I/O, no `this`.
//
// The paper (docs/paper/paper.md, branch ft/paper, lines 37-38/65-66) pins the
// only priced pair in the repo: "cached input at $0.0033/M versus uncached at
// $0.435/M on the pro model, a 120x gap". RECON verified 0.435 / 0.0033 =
// 131.8x — the "120x" is a conservative rounding. These constants make the gap
// a computed, testable number.

import type { ModelCost } from './types.ts'

/**
 * The pinned DeepSeek model cost constants.
 *
 * input/cacheRead keep the paper's pinned pro pair ($0.435 input vs
 * $0.0033 cacheRead, the 120x-cache economics in docs/paper/paper.md).
 * output + cacheWrite are filled from the REAL deepseek-v4-flash OpenRouter
 * rate card, fetched live 2026-08-23 (openrouter.ai /api/v1/models):
 * completion $0.09772/M, uncached prompt $0.04886/M (cache writes bill at
 * the prompt price — DeepSeek has no separate write discount). Previously
 * priced 0 pending the provider catalog (RECON gap); now real.
 */
export const DEEPSEEK_PRO_MODEL_COST: ModelCost = {
  input: 0.435,
  output: 0.09772,
  cacheRead: 0.0033,
  cacheWrite: 0.04886,
}

/**
 * Price a usage record against a model cost.
 *
 * @param usage - token counts; `cacheReadTokens`/`cacheWriteTokens` default 0.
 * @param cost - per-million-token USD prices.
 * @returns USD cost (never negative; 0 on empty usage).
 */
export function priceTokens(
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
  cost: ModelCost,
): number {
  const total = cost.input * usage.inputTokens
    + cost.output * usage.outputTokens
    + cost.cacheRead * (usage.cacheReadTokens ?? 0)
    + cost.cacheWrite * (usage.cacheWriteTokens ?? 0)
  if (total <= 0) return 0
  return total / 1e6
}

/**
 * The computed input/cacheRead price gap.
 *
 * @param cost - the model cost constants.
 * @returns `cost.input / cost.cacheRead` when `cacheRead > 0`, else `NaN`.
 */
export function cacheRatio(cost: ModelCost): number {
  return cost.cacheRead > 0 ? cost.input / cost.cacheRead : NaN
}

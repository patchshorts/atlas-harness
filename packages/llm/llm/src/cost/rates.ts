/**
 * Per-model token pricing table (USD cents per million tokens).
 *
 * Rates are configured, never fabricated: an empty table (the default) prices
 * nothing, and every unrated model costs 0 in the ledger (flagged, never NaN).
 * All prices are in USD cents per million tokens, so per-call cent math stays
 * in float-safe ranges for realistic token counts.
 *
 * @module @atlasai/atsh-llm/cost/rates
 */

import z from '@deepseek-ai/schemastery'

/**
 * Per-million-token price of one model call, in USD cents.
 *
 * Cache fields are optional: an absent cache price costs nothing (the provider
 * charges nothing for cache reads/writes, or the rate is unknown — both
 * produce a zero cache cost in the ledger).
 */
export interface ModelRate {
  /** Price of uncached input tokens, in USD cents per million tokens. */
  inputPerM: number
  /** Price of output tokens, in USD cents per million tokens. */
  outputPerM: number
  /** Price of cache-read input tokens, in USD cents per million tokens. */
  cacheReadPerM?: number
  /** Price of cache-write input tokens, in USD cents per million tokens. */
  cacheWritePerM?: number
}

/** Model name → per-model rate. An empty table prices nothing. */
export type ModelRateTable = Readonly<Record<string, ModelRate>>

/** Validates one model rate: rejects negative prices and missing required prices. */
export const ModelRateSchema: z<ModelRate> = z.object({
  inputPerM: z.number().min(0).required(),
  outputPerM: z.number().min(0).required(),
  cacheReadPerM: z.number().min(0),
  cacheWritePerM: z.number().min(0),
})

/** Validates a whole rate table; an absent table defaults to the empty table. */
export const ModelRateTableSchema: z<ModelRateTable> = z.dict(ModelRateSchema).default({})

/** The no-pricing default table. No rates are fabricated. */
export function emptyRateTable(): ModelRateTable {
  return {}
}

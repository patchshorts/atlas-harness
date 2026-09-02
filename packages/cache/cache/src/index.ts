/**
 * Deterministic + semantic LLM response cache: `ctx.llmCache` intercepts the
 * `llm/stream` Cordis waterfall, replays stored completions without an upstream call,
 * and stores completed responses on miss.
 * @module @atlasai/atsh-cache
 */

export { default, LlmCache } from './service.ts'
export type {
  CacheConfig,
  CacheHitRecord,
  CacheMissRecord,
  CacheSource,
  CacheStats,
  Embedder,
} from './types.ts'

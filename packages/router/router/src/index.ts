/**
 * Capability-gated LLM routing for the DeepSeek Harness: `ctx.llmRouter` intercepts the
 * `llm/stream` Cordis waterfall, rewrites `provider` / `model` for non-frozen requests
 * that mismatch their capability's configured route, and logs every completed call to a
 * SQLite call log, emitting `router/call-logged` for downstream training consumers.
 * @module @atlasai/atsh-router
 */

export { default, LlmRouter } from './service.ts'
export type {
  CallStatus,
  RouterCallRecord,
  RouterConfig,
  RouterRoute,
  RouteState,
} from './types.ts'

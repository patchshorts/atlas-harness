/**
 * C2 orchestration (`ctx.coordination`): spawns subagent workers through the
 * existing subagent registry (`ctx.subagents` — consumed, never modified) and
 * coordinates them through SQLite-backed shared-state channels.
 * @module @atlasai/atsh-coordination
 */

export { default, CoordinationService } from './service.ts'
export type {
  CoordinationConfig,
  CoordinationStats,
  SharedStateEntry,
  WorkerRecord,
  WorkerStatus,
} from './types.ts'

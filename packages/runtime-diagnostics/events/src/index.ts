/**
 * Typed, replayable diagnostic event stream for DeepSeek Harness runtime
 * signals. Tool calls, model calls, judge votes, budget state, and compaction
 * each produce typed events; alarms and verifiers consume the replayable fold.
 *
 * ## Golden rule
 *
 * The event stream is a diagnostic projection derived from the log by a pure
 * fold. It never mutates model-visible history; deep-frozen projections throw
 * on mutation. Appended events are frozen at append time, so no later write to
 * the emitter's object can alter recorded history.
 *
 * @module @atlasai/atsh-runtime-events
 */

export { RuntimeEventStream, foldStream, replayEvents } from './stream.ts'
export type {
  BudgetStateEvent,
  CompactionEvent,
  JudgeVoteEvent,
  ModelCallEvent,
  RuntimeEvent,
  RuntimeEventKind,
  ToolCallEvent,
} from './types.ts'

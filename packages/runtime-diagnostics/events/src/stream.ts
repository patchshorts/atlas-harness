/**
 * Append-only, replayable runtime event stream and its pure fold.
 *
 * The stream captures typed runtime signals in arrival order. It is
 * append-only: no event is ever reordered, replaced, or removed after
 * append. Consumers derive projections (read-only snapshots, replay folds)
 * that later alarms and verifiers fold over — never the live buffer.
 *
 * ## Golden rule
 *
 * The event buffer is a diagnostic projection derived from the log; this
 * module never mutates model-visible history. `snapshot()` returns a fresh,
 * read-only copy; the fold is a pure function. A caller cannot reach the
 * live buffer through any exported handle.
 *
 * @module @atlasai/atsh-runtime-events/src/stream
 */

import type { RuntimeEvent } from './types.ts'

/**
 * The append-only event stream.
 *
 * Thread model: single-threaded within one session fold. `append` enforces
 * monotonic `seq` and rejects out-of-order or duplicate sequence numbers so
 * a consumer can never double-consume an event.
 *
 * @remarks
 * Events are stored by value; appending freezes the event before it is
 * stored so later mutation of the caller's object cannot alter history.
 */
export class RuntimeEventStream {
  private readonly events: RuntimeEvent[] = []

  /**
   * Append one runtime event.
   *
   * @param event - the event to append. Its `seq` must be strictly greater
   *   than the last appended event's `seq`.
   * @returns this stream, for chaining.
   * @throws {Error} When `event.seq` is not strictly monotonic relative to
   *   the last appended event, or when the stream is read-only.
   */
  append(event: RuntimeEvent): this {
    const last = this.events[this.events.length - 1]
    if (last && event.seq <= last.seq) {
      throw new Error(
        `RuntimeEventStream: non-monotonic seq ${event.seq} after ${last.seq}`,
      )
    }
    this.events.push(Object.freeze(event) as RuntimeEvent)
    return this
  }

  /** Current event count. */
  get size(): number {
    return this.events.length
  }

  /** The sequence number of the last appended event, or `-1` when empty. */
  get lastSeq(): number {
    return this.events.length === 0
      ? -1
      : (this.events[this.events.length - 1]?.seq ?? -1)
  }

  /**
   * A frozen, read-only snapshot of the stream in append order.
   *
   * @returns a fresh array; the caller may hold it safely, but it throws on
   *   mutation (frozen elements and frozen array).
   */
  snapshot(): readonly RuntimeEvent[] {
    return Object.freeze([...this.events])
  }

  /** Is this stream currently read-only (from `freeze`)? */
  get readonly(): boolean {
    return Object.isFrozen(this.events)
  }

  /**
   * Make the stream read-only. Further `append` calls throw. The stream is
   * its own durable record once frozen; a consumer fold can then trust that
   * history is stable.
   *
   * @returns this stream, now frozen.
   */
  freeze(): this {
    Object.freeze(this.events)
    for (const event of this.events) {
      if (!Object.isFrozen(event)) {
        Object.freeze(event)
      }
    }
    return this
  }
}

/**
 * The pure fold: reduce the stream to a projection without mutating it.
 *
 * @param events - a read-only event list (from `snapshot` or a built list).
 * @param fold - the reducer.
 * @param initial - the accumulator's starting value.
 * @returns the fold result.
 * @remarks
 * This is a projection. It never mutates `events` or any event; the reducer
 * is responsible for treating the accumulator as immutable.
 */
export function foldStream<T>(
  events: readonly RuntimeEvent[],
  fold: (acc: T, event: RuntimeEvent) => T,
  initial: T,
): T {
  let acc = initial
  for (const event of events) {
    acc = fold(acc, event)
  }
  return acc
}

/**
 * Replay the stream into the same ordered sequence of events.
 *
 * This is the replayer: it returns each event in append order, preserving
 * the original objects (already frozen). The returned array is a fresh,
 * frozen projection — identical to `snapshot()` for a stream that was never
 * mutated, and the explicit replay primitive consumers call to re-derive
 * state.
 *
 * @param events - the read-only event list to replay.
 * @returns a frozen array of the same events, in the same order.
 */
export function replayEvents(events: readonly RuntimeEvent[]): readonly RuntimeEvent[] {
  return Object.freeze([...events])
}

/** Re-export the typed vocabulary under the stream module's namespace. */
export type {
  BudgetStateEvent,
  CompactionEvent,
  JudgeVoteEvent,
  ModelCallEvent,
  RuntimeEventKind,
  ToolCallEvent,
} from './types.ts'

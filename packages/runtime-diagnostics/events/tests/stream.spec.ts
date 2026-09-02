import { describe, expect, it } from 'vitest'
import {
  RuntimeEventStream,
  foldStream,
  replayEvents,
  type RuntimeEvent,
} from '@atlasai/atsh-runtime-events'

/**
 * Event-stream spec: replay fidelity + projection immutability.
 *
 * Cover the two contracts the stream exists for:
 *  1. Replay — a fold over the stream reproduces the injected sequence
 *     identically, in order, with all event fields intact.
 *  2. Immutability of projection — every projection handed to a consumer
 *     (snapshot, replay, frozen stream) is fresh, frozen, and detached from
 *     both the caller's input and the live buffer. Per the golden rule,
 *     deep-frozen projections throw on mutation.
 *
 * The stream is a pure in-memory diagnostic projection; these tests never
 * touch model-visible history, never require a provider key, and run in
 * milliseconds.
 */

function toolCall(seq: number, ts = 1000 + seq): RuntimeEvent {
  return { kind: 'tool/call', seq, ts, tool: `fs_read_${seq}` }
}

function modelCall(seq: number, ts = 1000 + seq): RuntimeEvent {
  return {
    kind: 'model/call',
    seq,
    ts,
    model: 'deepseek-v4-flash',
    inputTokens: 10,
    outputTokens: 5,
  }
}

function judgeVote(seq: number, vote: 'pass' | 'fail' | 'replan'): RuntimeEvent {
  return { kind: 'judge/vote', seq, ts: 1000 + seq, voter: 'panel-a', vote }
}

function budgetState(seq: number): RuntimeEvent {
  return { kind: 'budget/state', seq, ts: 1000 + seq, state: 'route', remaining: 90 }
}

function compaction(seq: number): RuntimeEvent {
  return { kind: 'compaction', seq, ts: 1000 + seq, mode: 'verbatim', retainedBytes: 2048 }
}

/** One event per runtime-signal kind, in append order. */
function fixture(): RuntimeEvent[] {
  return [
    toolCall(1),
    modelCall(2),
    judgeVote(3, 'pass'),
    budgetState(4),
    compaction(5),
  ]
}

describe('RuntimeEventStream — append + order', () => {
  it('preserves events in append order with monotonic size/lastSeq', () => {
    const stream = new RuntimeEventStream()
    for (const event of fixture()) stream.append(event)

    expect(stream.size).toBe(5)
    expect(stream.lastSeq).toBe(5)
    const snap = stream.snapshot()
    expect(snap.map(e => e.seq)).toEqual([1, 2, 3, 4, 5])
    expect(snap.map(e => e.kind)).toEqual([
      'tool/call',
      'model/call',
      'judge/vote',
      'budget/state',
      'compaction',
    ])
  })

  it('rejects a non-monotonic seq (duplicate or rewind) without mutating the stream', () => {
    const stream = new RuntimeEventStream()
    stream.append(toolCall(1))
    expect(() => stream.append(toolCall(1))).toThrow(/non-monotonic/)
    expect(stream.size).toBe(1)

    stream.append(modelCall(5))
    expect(() => stream.append(modelCall(3))).toThrow(/non-monotonic/)
    expect(stream.size).toBe(2)
  })

  it('discriminates each typed event kind to its concrete shape', () => {
    const events = fixture()
    expect(events).toHaveLength(5)
    for (const event of events) {
      switch (event.kind) {
        case 'tool/call':
          expect(event.tool).toBe('fs_read_1')
          expect(event.input).toBeUndefined()
          break
        case 'model/call':
          expect(event.model).toBe('deepseek-v4-flash')
          expect(event.inputTokens).toBe(10)
          break
        case 'judge/vote':
          expect(event.voter).toBe('panel-a')
          expect(event.vote).toBe('pass')
          break
        case 'budget/state':
          expect(event.state).toBe('route')
          expect(event.remaining).toBe(90)
          break
        case 'compaction':
          expect(event.mode).toBe('verbatim')
          expect(event.retainedBytes).toBe(2048)
          break
      }
    }
  })
})

describe('Projection immutability — deep-frozen snapshots throw on mutation', () => {
  it('snapshot() returns a fresh frozen array of frozen events, detached from the stream', () => {
    const stream = new RuntimeEventStream()
    for (const event of fixture()) stream.append(event)

    const first = stream.snapshot()
    const second = stream.snapshot()

    // Fresh array per call, sharing the same frozen event objects.
    expect(first).not.toBe(second)
    expect(second[0]).toBe(first[0])

    // The projection itself is frozen and cannot be reordered/replaced.
    expect(Object.isFrozen(first)).toBe(true)
    // The returned events are frozen and cannot be rewritten by a consumer.
    for (const event of first) {
      expect(Object.isFrozen(event)).toBe(true)
    }

    // Appending later does not change an already-issued projection.
    stream.append(modelCall(6))
    expect(first.length).toBe(5)
    expect(stream.size).toBe(6)
  })

  it('the live buffer is unreachable: mutating the returned projection throws', () => {
    const stream = new RuntimeEventStream()
    stream.append(toolCall(1))
    stream.append(modelCall(2))

    const snap = stream.snapshot() as unknown as RuntimeEvent[]

    // Array-level mutation (reorder / replace) is blocked.
    expect(() => snap.reverse()).toThrow()
    // Event-level mutation of a surveyed event is blocked.
    expect(() => {
      ;(snap[0] as unknown as { kind: string }).kind = 'compaction'
    }).toThrow()

    // The underlying history is byte-for-byte unchanged.
    expect(stream.snapshot()[0]?.kind).toBe('tool/call')
  })

  it('append() freezes the caller object so a later write cannot alter recorded history', () => {
    const stream = new RuntimeEventStream()
    const source: RuntimeEvent = { kind: 'budget/state', seq: 1, ts: 1000, state: 'veto' }
    stream.append(source)

    // The appended event is frozen immediately — mutation of the source throws.
    expect(Object.isFrozen(source)).toBe(true)
    expect(() => {
      ;(source as unknown as { state: string }).state = 'route'
    }).toThrow()

    // History is stable regardless.
    const snap = stream.snapshot()
    const first = snap[0]!
    if (first.kind === 'budget/state') {
      expect(first.state).toBe('veto')
    } else {
      throw new Error('expected budget/state')
    }
  })

  it('freeze() makes the stream read-only; further append throws', () => {
    const stream = new RuntimeEventStream()
    stream.append(toolCall(1))
    expect(stream.readonly).toBe(false)

    stream.freeze()
    expect(stream.readonly).toBe(true)
    expect(() => stream.append(modelCall(2))).toThrow()
    expect(stream.size).toBe(1)
    // Events surveyed are frozen too.
    expect(Object.isFrozen(stream.snapshot()[0])).toBe(true)
  })
})

describe('Replay — foldStream and replayEvents reproduce the sequence', () => {
  it('foldStream replays an injected sequence identically, as a pure fold', () => {
    const events = fixture()
    const seen: string[] = foldStream<string[]>(
      events,
      (acc, event) => {
        acc.push(`${event.seq}:${event.kind}`)
        return acc
      },
      [],
    )

    expect(seen).toEqual([
      '1:tool/call',
      '2:model/call',
      '3:judge/vote',
      '4:budget/state',
      '5:compaction',
    ])

    // The fold is pure: the source list is not mutated by the reduction.
    expect(events.length).toBe(5)
    expect(events.map(e => e.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('foldStream reproduces the same projection from the live stream snapshot', () => {
    const stream = new RuntimeEventStream()
    for (const event of fixture()) stream.append(event)

    const seqs = foldStream<number[]>(stream.snapshot(), (acc, e) => (acc.push(e.seq), acc), [])
    expect(seqs).toEqual([1, 2, 3, 4, 5])

    const kinds = foldStream<number[]>(
      stream.snapshot(),
      (acc, e) => (e.kind === 'judge/vote' ? (acc.push(e.seq), acc) : acc),
      [],
    )
    expect(kinds).toEqual([3])
  })

  it('replayEvents returns a fresh frozen array preserving order and object identity', () => {
    const stream = new RuntimeEventStream()
    for (const event of fixture()) stream.append(event)

    const direct = stream.snapshot()
    const replayed = replayEvents(direct)

    expect(replayed).not.toBe(direct)
    expect(Object.isFrozen(replayed)).toBe(true)
    expect(replayed.map(e => e.seq)).toEqual([1, 2, 3, 4, 5])
    // Same frozen event objects, replayed in order.
    expect(replayed[0]).toBe(direct[0])
    expect(replayed[4]).toBe(direct[4])
  })

  it('replayEvents survives across a fresh consumer list (full re-derivation)', () => {
    const stream = new RuntimeEventStream()
    stream.append(toolCall(1))
    stream.append(judgeVote(2, 'replan'))
    stream.freeze()

    const first = replayEvents(replayEvents(stream.snapshot()))
    const second = replayEvents(replayEvents(stream.snapshot()))
    expect(first.map(e => e.kind)).toEqual(['tool/call', 'judge/vote'])
    expect(first.map(e => e.seq)).toEqual([1, 2])
    expect(second.map(e => e.seq)).toEqual([1, 2])
  })
})

import { describe, expect, it } from 'vitest'
import { CallId, createMessage, createUserMessage } from '@atlasai/atsh-llm'
import type { UserMessage } from '@atlasai/atsh-llm'
import { Session, SessionId, foldSurface, interruptedTurnClosers } from '@atlasai/atsh-session'

/**
 * Golden-rule regression suite: "never mutate model-visible history. Message
 * history is derived from the log by a pure function fold. Deep-frozen
 * projections throw on mutation." Every projection handed to a consumer must
 * be fresh, frozen, and detached from both the caller's input and the log.
 */

describe('golden rule — frozen projections', () => {
  it('deriveMessages() returns a fresh array of shared, deep-frozen messages per call', () => {
    const session = Session.create(SessionId('golden-fresh'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const first = session.deriveMessages()
    const second = session.deriveMessages()

    // Fresh array per call, sharing the same frozen Message objects.
    expect(first).not.toBe(second)
    expect(second[0]).toBe(first[0])
    for (const message of first) {
      expect(Object.isFrozen(message)).toBe(true)
      expect(Object.isFrozen(message.content)).toBe(true)
      for (const block of message.content) {
        expect(Object.isFrozen(block)).toBe(true)
      }
    }
    // Deep-frozen projections throw on mutation.
    expect(() => { (first[0]!.content[0] as { text: string }).text = 'mutated' }).toThrow()
  })

  it('a deliberate mutation of a derived projection throws and never corrupts the log', () => {
    const session = Session.create(SessionId('golden-mutation'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'original' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const derived = session.deriveMessages()
    expect(() => { (derived[0]!.content[0] as { text: string }).text = 'mutated' }).toThrow()
    // The log was not corrupted: a fresh derivation still returns the original text.
    expect(session.deriveMessages()[0]!.content).toEqual([{ type: 'text', text: 'original' }])
  })

  it('events snapshot is frozen and a previously returned array never grows', () => {
    const session = Session.create(SessionId('golden-events'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'one' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const snap = session.events
    const beforeLength = snap.length
    expect(Object.isFrozen(snap)).toBe(true)

    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'two' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'three' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    expect(snap).toHaveLength(beforeLength)
    expect(session.events).toHaveLength(beforeLength + 2)
    expect(Object.isFrozen(session.events)).toBe(true)
  })

  it("append-path data snapshot is detached from the caller's mutable input", () => {
    const session = Session.create(SessionId('golden-detached'))
    session.append('turn/start', { turn: 1 })

    const userData = {
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'user' },
    }
    const original = structuredClone(userData)
    session.append('user/message', userData as unknown as UserMessage, { surfaceOp: 'append' })

    // Mutating the caller's object after the append must not change the log.
    userData.content.push({ type: 'text', text: 'added later' })

    const logged = session.events.at(-1)!.data
    expect(logged).toEqual(original)
    expect(logged).not.toEqual(userData)
    expect(Object.isFrozen(logged)).toBe(true)
  })

  it('repair path appends closers, never rewrites, and stays frozen', () => {
    const session = Session.create(SessionId('golden-repair'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'before crash' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [
          { type: 'text', text: 'calling a tool' },
          { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{}' },
        ],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/call', { turn: 1, step: 1, callId: CallId('call-1'), name: 'bash', arguments: '{}' })

    // interruptedTurnClosers is a pure function: the input log is unchanged after the call.
    const before = structuredClone(session.events)
    const firstEvent = session.events[0]!
    const beforeSeq = session.seq
    const closers = interruptedTurnClosers(session.events)
    expect(session.events).toEqual(before)
    expect(closers.map(closer => closer.type)).toEqual(['tool/result', 'step/end', 'turn/end'])

    // Repair appends: the log grows with contiguous seqs — nothing is rewritten.
    for (const closer of closers) {
      if (closer.type === 'tool/result') {
        session.append('tool/result', closer.data, { surfaceOp: 'append' })
      } else {
        session.append(closer.type, closer.data)
      }
    }
    expect(session.seq).toBe(beforeSeq + closers.length)
    expect(session.events.every((event, index) => event.seq === index)).toBe(true)
    expect(session.events[0]).toBe(firstEvent)
    expect(Object.isFrozen(firstEvent)).toBe(true)

    // Derivation over the repaired log is still frozen and still throws on mutation.
    const derived = session.deriveMessages()
    expect(derived).toHaveLength(3)
    for (const message of derived) {
      expect(Object.isFrozen(message)).toBe(true)
    }
    expect(() => { (derived[0]!.content[0] as { text: string }).text = 'mutated' }).toThrow()
  })

  it('foldSurface is pure: the same log folded twice is byte-identical and leaves its input untouched', () => {
    const session = Session.create(SessionId('golden-fold-purity'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'one' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'two' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const nodes = session.surface.nodes
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary' }], source: { kind: 'plugin', plugin: 'compact' },
    }), { surfaceOp: { op: 'replace', start: nodes[0]!, end: nodes[1]! }, sourceEventSeqs: [nodes[0]!, nodes[1]!] })

    const events = session.events
    const first = foldSurface(events)
    const second = foldSurface(events)

    // Deterministic: a second fold of the same log is byte-identical.
    expect(first).toEqual(second)
    expect(first.nodes).toEqual([3])

    // Pure: folding never changes the input log.
    expect(events).toEqual(session.events)
    expect(events).toHaveLength(4)

    // Detached: the result arrays are fresh copies, never shared fold state.
    first.nodes.push(999)
    first.replacements.length = 0
    expect(second.nodes).toEqual([3])
    expect(second.replacements).toHaveLength(1)
  })

  it('derivation over a surface-replaced log stays fresh, frozen, and throws on mutation', () => {
    const session = Session.create(SessionId('golden-replace-purity'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'one' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'two' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const nodes = session.surface.nodes
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary' }], source: { kind: 'plugin', plugin: 'compact' },
    }), { surfaceOp: { op: 'replace', start: nodes[0]!, end: nodes[1]! }, sourceEventSeqs: [nodes[0]!, nodes[1]!] })

    const derived = session.deriveMessages()
    expect(derived).toHaveLength(1)
    for (const message of derived) {
      expect(Object.isFrozen(message)).toBe(true)
      expect(Object.isFrozen(message.content)).toBe(true)
    }
    // Deep-frozen projection: mutation throws and the replaced log is not corrupted.
    expect(() => { (derived[0]!.content[0] as { text: string }).text = 'mutated' }).toThrow()
    expect(session.deriveMessages()[0]!.content).toEqual([{ type: 'text', text: 'summary' }])
  })
})

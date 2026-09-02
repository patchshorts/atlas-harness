import { describe, expect, it } from 'vitest'
import { CallId, createMessage, createUserMessage } from '@atlasai/atsh-llm'
import type { Message } from '@atlasai/atsh-llm'
import { serializeMessages } from '../src/serialize.ts'

/**
 * Golden-rule regression suite at the DeepSeek provider boundary: the wire
 * serializer must never mutate the model-visible history it is given —
 * inputs stay byte-identical, and deep-frozen input is accepted as-is.
 */

describe('golden rule — provider boundary preserves input history', () => {
  function buildMessages(): Message[] {
    return [
      createUserMessage({
        content: [{ type: 'text', text: 'hello' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      createMessage({
        role: 'assistant',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool-call', id: CallId('call-1'), name: 'get_weather', arguments: '{"city":"Paris"}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      createUserMessage({
        content: [{ type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'text', text: 'Sunny 22C' }] }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ]
  }

  it('serializeMessages leaves its input messages byte-identical', () => {
    const messages = buildMessages()
    const before = structuredClone(messages)
    const wire = serializeMessages(messages)
    expect(wire.length).toBeGreaterThan(0)
    expect(messages).toEqual(before)
  })

  it('serializeMessages accepts deep-frozen input and produces the same wire output', () => {
    const expected = serializeMessages(buildMessages())
    const frozen = buildMessages()
    for (const message of frozen) {
      Object.freeze(message)
      Object.freeze(message.content)
      for (const block of message.content) {
        Object.freeze(block)
      }
    }
    // Must not throw, and must produce the identical wire shape.
    expect(serializeMessages(frozen)).toEqual(expected)
  })
})

import { describe, expect, it } from 'vitest'
import { CallId, createMessage, createUserMessage } from '@atlasai/atsh-llm'
import type { GenerateOptions, Message } from '@atlasai/atsh-llm'
import { toPiContext } from '../src/context.ts'

/**
 * Golden-rule regression suite at the pi-ai provider boundary: building the
 * pi-ai context must never mutate the input history — the messages array
 * stays byte-identical, and the conversion is structurally faithful
 * (assistant tool calls become toolCall blocks, tool results become
 * toolResult messages).
 */

describe('golden rule — pi-ai context builds without mutating input history', () => {
  function request(messages: Message[]): GenerateOptions {
    return { provider: 'pi-ai', model: 'pi-ai-1', messages }
  }

  function buildMessages(): Message[] {
    return [
      createUserMessage({
        content: [{ type: 'text', text: 'user text' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: CallId('call-1'), name: 'lookup', arguments: '{}' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      createUserMessage({
        content: [{ type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'text', text: 'found' }] }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ]
  }

  it('toPiContext does not mutate the input messages array', () => {
    const messages = buildMessages()
    const before = structuredClone(messages)
    toPiContext(request(messages))
    expect(messages).toEqual(before)
  })

  it('converts the input to a structurally correct pi-ai context', () => {
    const context = toPiContext(request(buildMessages()))
    expect(context.messages).toHaveLength(3)
    expect(context.messages.map(message => message.role)).toEqual(['user', 'assistant', 'toolResult'])
    // Assistant tool calls become toolCall blocks.
    expect(context.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call-1', name: 'lookup', arguments: {} }],
    })
    // Tool results become toolResult messages with the recovered tool name.
    expect(context.messages[2]).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'lookup',
      isError: false,
    })
  })
})

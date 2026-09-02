/**
 * Unit tests for the bench classifier — one fixture per correction class,
 * §2.3 negative cases, lexicon edge cases, and loader/config behavior.
 *
 * The fixtures model the harness `SessionEvent` envelope exactly as
 * `packages/session-query` exports it: `{ type, seq, time, data }` with
 * `data` carrying the `SessionEventMap` payload (spec §3 — type + seq intact).
 *
 * @module @atlasai/atsh-bench/classify.spec
 */

import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  classifySession,
  loadEvents,
  loadSession,
  extractText,
  canonicalJson,
  sha256Hex,
  loadManifestLexicon,
  loadConfigFromManifest,
  matchLexicon,
  DEFAULT_CONFIG,
  FROZEN_LEXICON,
} from '../src/index.ts'
import type { SessionLogEvent } from '../src/index.ts'

/** One user/assistant text block, as produced by the harness. */
const textBlock = (text: string) => ({ type: 'text', text })

/** A harness-shaped event. */
function event(type: string, seq: number, data: Record<string, unknown>): SessionLogEvent {
  return { type, seq, time: 1_700_000_000_000 + seq, data }
}

const toolCall = (seq: number, name: string, args: Record<string, unknown>): SessionLogEvent =>
  event('tool/call', seq, { turn: 1, step: 1, callId: `call-${seq}`, name, arguments: JSON.stringify(args) })

/** A REAL harness-shape tool/result: errors are marked
 * `isError: true` on the `tool-result` content block — there is NO top-level
 * `data.error` object. Verified against 212/212 clone-arm exports. */
const realToolResult = (seq: number, isError = false): SessionLogEvent =>
  event('tool/result', seq, {
    turn: 1,
    step: 1,
    message: {
      source: { kind: 'tool', callId: `call-${seq}` },
      content: [{
        type: 'tool-result',
        toolCallId: `call-${seq}`,
        isError,
        content: [{ type: 'text', text: isError ? 'Error: command failed with exit code 1' : 'ok' }],
      }],
    },
  })

const toolResult = (seq: number, error?: { name: string; code: string }): SessionLogEvent =>
  event('tool/result', seq, { turn: 1, step: 1, message: { id: 'm', role: 'user', content: [] }, error })

const assistantMessage = (seq: number, text: string, sourceKind = 'model'): SessionLogEvent =>
  event('assistant/message', seq, {
    turn: 1,
    step: 1,
    message: { id: `a-${seq}`, role: 'assistant', content: [textBlock(text)], source: { kind: sourceKind, provider: 'deepseek', model: 'x' } },
  })

const userMessage = (seq: number, text: string): SessionLogEvent =>
  event('user/message', seq, { id: `u-${seq}`, role: 'user', content: [textBlock(text)], source: { kind: 'user' } })

const todoWrite = (seq: number, todos: Array<{ content: string; status: string }>): SessionLogEvent =>
  event('todo/write', seq, { todos })

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url))

describe('bench-classify — C1 retried failed tool call', () => {
  it('counts a same-name retry within 4 events of an erroring result', () => {
    const events = [
      toolCall(1, 'build', { command: 'pnpm build' }),
      toolResult(2, { name: 'Error', code: 'E1' }),
      toolCall(3, 'build', { command: 'pnpm build' }),
    ]
    const result = classifySession(events)
    expect(result.counts.C1).toBe(1)
    expect(result.total).toBe(1)
    expect(result.hits[0]?.class).toBe('C1')
  })

  it('counts a retry at the window boundary (4th event after the result)', () => {
    const events = [
      toolCall(1, 'bash', { command: 'x' }),
      toolResult(2, { name: 'Error', code: 'E1' }),
      assistantMessage(3, 'let me check'),
      assistantMessage(4, 'still checking'),
      assistantMessage(5, 'almost'),
      toolCall(6, 'bash', { command: 'x' }), // 4th event after the result
    ]
    expect(classifySession(events).counts.C1).toBe(1)
  })

  it('counts a same-name retry on a REAL harness-shape result (isError block, the bench workstream)', () => {
    const events = [
      toolCall(1, 'bash', { command: 'pnpm build' }),
      realToolResult(2, true),
      toolCall(3, 'bash', { command: 'pnpm build' }),
    ]
    const result = classifySession(events)
    expect(result.counts.C1).toBe(1)
    expect(result.hits[0]?.class).toBe('C1')
  })

  it('does NOT count a real-shape result with isError:false as an error', () => {
    const events = [
      toolCall(1, 'bash', { command: 'ls' }),
      realToolResult(2, false),
      toolCall(3, 'bash', { command: 'ls' }),
    ]
    expect(classifySession(events).counts.C1).toBe(0)
  })

  it('does not count a retry beyond the 4-event window', () => {
    const events = [
      toolCall(1, 'bash', { command: 'x' }),
      toolResult(2, { name: 'Error', code: 'E1' }),
      assistantMessage(3, 'one'),
      assistantMessage(4, 'two'),
      assistantMessage(5, 'three'),
      assistantMessage(6, 'four'),
      toolCall(7, 'bash', { command: 'x' }), // 5th event after the result
    ]
    expect(classifySession(events).counts.C1).toBe(0)
  })

  it('does not count a dead-end error the agent never re-calls (spec §2.3)', () => {
    const events = [
      toolCall(1, 'write', { file_path: '/a', content: 'v1' }),
      toolResult(2, { name: 'Error', code: 'E1' }),
      assistantMessage(3, 'ok, moving on'),
    ]
    expect(classifySession(events).counts.C1).toBe(0)
  })

  it('does not count a first-attempt failure with no retry (spec §2.3)', () => {
    const events = [toolCall(1, 'bash', { command: 'x' }), toolResult(2, { name: 'Error', code: 'E1' })]
    expect(classifySession(events).counts.C1).toBe(0)
  })

  it('ignores an error result with a null/absent error object', () => {
    const events = [
      toolCall(1, 'write', { file_path: '/a', content: 'v1' }),
      event('tool/result', 2, { turn: 1, step: 1, message: { id: 'm', role: 'user', content: [] }, error: null }),
      toolCall(3, 'write', { file_path: '/a', content: 'v1' }),
    ]
    expect(classifySession(events).counts.C1).toBe(0)
  })
})

describe('bench-classify — C2 reverted file edit', () => {
  it('counts a write that restores earlier content to the same path', () => {
    const events = [
      toolCall(1, 'tool:write', { file_path: '/src/a.ts', content: 'v1' }),
      toolCall(2, 'tool:write', { file_path: '/src/a.ts', content: 'v2' }),
      toolCall(3, 'tool:write', { file_path: '/src/a.ts', content: 'v1' }), // restore
    ]
    const result = classifySession(events)
    expect(result.counts.C2).toBe(1)
    expect(result.hits[0]?.note).toContain('/src/a.ts')
  })

  it('does not count distinct content or the first write', () => {
    const events = [
      toolCall(1, 'tool:write', { file_path: '/a', content: 'v1' }),
      toolCall(2, 'tool:write', { file_path: '/a', content: 'v2' }),
      toolCall(3, 'tool:write', { file_path: '/a', content: 'v3' }),
    ]
    expect(classifySession(events).counts.C2).toBe(0)
  })

  it('counts restores across the edit family (edit with old/new strings)', () => {
    const events = [
      toolCall(1, 'write', { file_path: '/b', content: 'base' }),
      toolCall(2, 'tool:edit', { file_path: '/b', old_string: 'base', new_string: 'changed' }),
      toolCall(3, 'write', { file_path: '/b', content: 'base' }), // restore via write
    ]
    expect(classifySession(events).counts.C2).toBe(1)
  })

  it('treats key order as irrelevant for the content hash', () => {
    const events = [
      toolCall(1, 'tool:edit', { file_path: '/c', old_string: 'a', new_string: 'b' }),
      toolCall(2, 'tool:edit', { new_string: 'b', old_string: 'a', file_path: '/c' }), // same payload, shuffled keys
    ]
    expect(classifySession(events).counts.C2).toBe(1)
  })

  it('skips malformed arguments deterministically', () => {
    const events = [
      toolCall(1, 'tool:write', { file_path: '/a', content: 'v1' }),
      event('tool/call', 2, { turn: 1, step: 1, callId: 'c2', name: 'tool:write', arguments: '{broken' }),
      toolCall(3, 'tool:write', { file_path: '/a', content: 'v1' }),
    ]
    expect(classifySession(events).counts.C2).toBe(1) // only the valid restore counts
  })
})

describe('bench-classify — C3 self-correction message', () => {
  it('counts an assistant message with a lexicon token after an erroring result', () => {
    const events = [
      toolCall(1, 'bash', { command: 'x' }),
      toolResult(2, { name: 'Error', code: 'E1' }),
      assistantMessage(3, 'I made a mistake, let me fix this'),
    ]
    const result = classifySession(events)
    expect(result.counts.C3).toBe(1)
    expect(result.total).toBe(1)
  })

  it('does not count the same message without a prior error or todo flip', () => {
    const events = [assistantMessage(1, 'I will fix this now'), assistantMessage(2, 'all good')]
    expect(classifySession(events).counts.C3).toBe(0)
  })

  it('excludes non-model (summarizer/compaction) assistant messages (spec §2.3)', () => {
    const events = [
      toolResult(1, { name: 'Error', code: 'E1' }),
      assistantMessage(2, 'summary: I should fix this', 'summary'),
    ]
    expect(classifySession(events).counts.C3).toBe(0)
  })

  it('counts after a todo/write state flip (completed -> in_progress)', () => {
    const events = [
      todoWrite(1, [{ content: 'task A', status: 'completed' }]),
      todoWrite(2, [{ content: 'task A', status: 'in_progress' }]),
      assistantMessage(3, 'I need to redo this task'),
    ]
    expect(classifySession(events).counts.C3).toBe(1)
  })
})

describe('bench-classify — C4 repaired plan deviation', () => {
  it('counts a completed todo flipped back to in_progress', () => {
    const events = [
      todoWrite(1, [{ content: 'task A', status: 'completed' }]),
      todoWrite(2, [{ content: 'task A', status: 'in_progress' }]),
    ]
    const result = classifySession(events)
    expect(result.counts.C4).toBe(1)
    expect(result.hits[0]?.note).toContain('task A')
  })

  it('counts a completed todo flipped back to pending (done -> todo)', () => {
    const events = [
      todoWrite(1, [{ content: 'task A', status: 'completed' }]),
      todoWrite(2, [{ content: 'task A', status: 'pending' }]),
    ]
    expect(classifySession(events).counts.C4).toBe(1)
  })

  it('counts every flipped item in one todo/write event', () => {
    const events = [
      todoWrite(1, [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'completed' },
      ]),
      todoWrite(2, [
        { content: 'a', status: 'in_progress' },
        { content: 'b', status: 'pending' },
      ]),
    ]
    expect(classifySession(events).counts.C4).toBe(2)
  })

  it('does not count forward or same-state transitions', () => {
    const events = [
      todoWrite(1, [{ content: 'a', status: 'pending' }]),
      todoWrite(2, [{ content: 'a', status: 'in_progress' }]), // pending -> in_progress
      todoWrite(3, [{ content: 'a', status: 'completed' }]), // forward progress
      todoWrite(4, [{ content: 'a', status: 'completed' }]), // no change
    ]
    expect(classifySession(events).counts.C4).toBe(0)
  })
})

describe('bench-classify — C5 user correction', () => {
  it('counts a short user message with a lexicon token within 6 events of an assistant action', () => {
    const events = [
      assistantMessage(1, 'here is the patch'),
      toolCall(2, 'write', { file_path: '/a', content: 'x' }),
      userMessage(3, 'no, that is wrong — redo it'),
    ]
    const result = classifySession(events)
    expect(result.counts.C5).toBe(1)
    expect(result.hits[0]?.note).toContain('27 chars')
  })

  it('ignores user messages over 200 chars (task prose, spec §2.3)', () => {
    const longTask = 'x'.repeat(201)
    const events = [assistantMessage(1, 'done'), userMessage(2, `wrong, please: ${longTask}`)]
    expect(classifySession(events).counts.C5).toBe(0)
  })

  it('ignores user messages beyond the 6-event window', () => {
    const events = [
      assistantMessage(1, 'done'),
      todoWrite(2, [{ content: 'a', status: 'completed' }]),
      todoWrite(3, [{ content: 'a', status: 'completed' }]),
      todoWrite(4, [{ content: 'a', status: 'completed' }]),
      todoWrite(5, [{ content: 'a', status: 'completed' }]),
      todoWrite(6, [{ content: 'a', status: 'completed' }]),
      todoWrite(7, [{ content: 'a', status: 'completed' }]),
      userMessage(8, 'no, wrong'), // 7 events after the last assistant action (seq 1)
    ]
    expect(classifySession(events).counts.C5).toBe(0)
  })

  it('ignores the first user message when no assistant action preceded it', () => {
    const events = [userMessage(1, 'please fix this and also do the thing')]
    expect(classifySession(events).counts.C5).toBe(0)
  })
})

describe('bench-classify — lexicon matching (spec §2.2)', () => {
  it('matches whole words only: "no" does not match "know" or "annotate"', () => {
    expect(matchLexicon('I know the answer', FROZEN_LEXICON)).toBe(false)
    expect(matchLexicon('please annotate this', FROZEN_LEXICON)).toBe(false)
    expect(matchLexicon('no, stop', FROZEN_LEXICON)).toBe(true)
  })

  it('matches case-insensitively on lowercased text', () => {
    expect(matchLexicon('My Error Was Bad', FROZEN_LEXICON)).toBe(true)
    expect(matchLexicon('THAT FAILED', FROZEN_LEXICON)).toBe(true)
  })

  it('matches multi-word tokens ("roll back", "does not work")', () => {
    expect(matchLexicon('we need to roll back that change', FROZEN_LEXICON)).toBe(true)
    expect(matchLexicon('the build does not work', FROZEN_LEXICON)).toBe(true)
  })

  it('matches the "use ... instead" phrase when both parts are present', () => {
    expect(matchLexicon('use the other api instead', FROZEN_LEXICON)).toBe(true)
    expect(matchLexicon('use the other api', FROZEN_LEXICON)).toBe(false)
  })

  it('supports an empty message and an empty lexicon', () => {
    expect(matchLexicon('', FROZEN_LEXICON)).toBe(false)
    expect(matchLexicon('wrong', [])).toBe(false)
  })
})

describe('bench-classify — session log loading (spec §3)', () => {
  it('accepts a bare event array', () => {
    const events = [toolCall(1, 'write', { file_path: '/a', content: 'x' })]
    expect(loadEvents(events)).toHaveLength(1)
  })

  it('accepts the { events } and { log } wrappers', () => {
    const events = [toolCall(1, 'write', { file_path: '/a', content: 'x' })]
    expect(loadEvents({ events })).toHaveLength(1)
    expect(loadEvents({ log: events })).toHaveLength(1)
  })

  it('carries the session id from the { sessionId, events } shape', () => {
    const session = loadSession({ sessionId: 'sess-1', events: [toolCall(1, 'write', { file_path: '/a', content: 'x' })] })
    expect(session.sessionId).toBe('sess-1')
    expect(session.events).toHaveLength(1)
  })

  it('reorders out-of-order events by seq', () => {
    const events = loadEvents([toolCall(5, 'bash', { command: 'x' }), toolCall(1, 'write', { file_path: '/a', content: 'x' })])
    expect(events.map(e => e.seq)).toEqual([1, 5])
  })

  it('throws on malformed input — missing seq, missing type, non-object', () => {
    expect(() => loadEvents([{ type: 'tool/call', data: {} }])).toThrow(/seq/)
    expect(() => loadEvents([{ seq: 1, data: {} }])).toThrow(/type/)
    expect(() => loadEvents('nope')).toThrow(/array or object/)
  })
})

describe('bench-classify — text extraction and hashing helpers', () => {
  it('extracts only visible text blocks, not reasoning', () => {
    const content = [
      textBlock('visible line'),
      { type: 'reasoning', text: 'hidden reasoning' },
      textBlock('second line'),
    ]
    expect(extractText(content)).toBe('visible line\nsecond line')
    expect(extractText('raw string')).toBe('raw string')
    expect(extractText(undefined)).toBe('')
  })

  it('hashes canonical JSON independent of key order', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }))
    expect(sha256Hex(canonicalJson({ a: 1, b: 2 }))).toBe(sha256Hex(canonicalJson({ b: 2, a: 1 })))
  })
})

describe('bench-classify — manifest config loading (spec §2.2 pre-registration)', () => {
  it('loads the frozen lexicon row from bench-manifest.json', () => {
    const lexicon = loadManifestLexicon(`${FIXTURE_DIR}bench-manifest.fixture.json`)
    expect(lexicon).toEqual([...FROZEN_LEXICON])
  })

  it('loads a full config from the manifest, preserving non-lexicon overrides', () => {
    const config = loadConfigFromManifest(`${FIXTURE_DIR}bench-manifest.fixture.json`, { c1RetryWindow: 7 })
    expect(config.lexicon).toEqual([...FROZEN_LEXICON])
    expect(config.c1RetryWindow).toBe(7)
    expect(config.c5AssistantWindow).toBe(DEFAULT_CONFIG.c5AssistantWindow)
  })

  it('throws on a missing manifest', () => {
    expect(() => loadManifestLexicon('/nonexistent/manifest.json')).toThrow(/cannot read manifest/)
  })

  it('throws when the lexicon row is not frozen', () => {
    expect(() => loadManifestLexicon(`${FIXTURE_DIR}bench-manifest.unfrozen.fixture.json`)).toThrow(/not frozen/)
  })
})

describe('bench-classify — aggregate metrics', () => {
  it('computes corrections per 100 tool calls', () => {
    const events = [
      toolCall(1, 'bash', { command: 'x' }),
      toolResult(2, { name: 'Error', code: 'E1' }),
      toolCall(3, 'bash', { command: 'x' }), // C1
      toolCall(4, 'bash', { command: 'y' }),
      toolCall(5, 'bash', { command: 'z' }),
      toolCall(6, 'bash', { command: 'w' }),
      toolCall(7, 'bash', { command: 'v' }),
      toolCall(8, 'bash', { command: 'u' }),
      toolCall(9, 'bash', { command: 't' }),
      toolCall(10, 'bash', { command: 's' }),
      toolCall(11, 'bash', { command: 'r' }),
    ]
    const result = classifySession(events) // 1 correction / 10 calls
    expect(result.toolCalls).toBe(10)
    expect(result.total).toBe(1)
    expect(result.per100Calls).toBeCloseTo(10, 1)
  })

  it('reports zero per-100-calls when the session has no tool calls', () => {
    const result = classifySession([assistantMessage(1, 'hello')])
    expect(result.toolCalls).toBe(0)
    expect(result.per100Calls).toBe(0)
    expect(result.total).toBe(0)
  })

  it('is deterministic — identical input yields identical output', () => {
    const events = [
      toolCall(1, 'write', { file_path: '/a', content: 'v1' }),
      toolResult(2, { name: 'Error', code: 'E1' }),
      toolCall(3, 'write', { file_path: '/a', content: 'v1' }),
      toolCall(4, 'write', { file_path: '/a', content: 'v2' }),
      assistantMessage(5, 'I will fix this'),
      todoWrite(6, [{ content: 'a', status: 'completed' }]),
      todoWrite(7, [{ content: 'a', status: 'in_progress' }]),
      userMessage(8, 'no, redo'),
    ]
    const first = classifySession(events)
    const second = classifySession(events)
    expect(second).toEqual(first)
  })

  it('classifies a realistic mixed session with exact totals', () => {
    const events = [
      userMessage(1, 'Implement the feature per the spec.'),
      assistantMessage(2, 'I will start by reading the code.'),
      toolCall(3, 'read', { file_path: '/src/a.ts' }),
      toolResult(4),
      toolCall(5, 'write', { file_path: '/src/a.ts', content: 'v1' }),
      toolResult(6),
      toolCall(7, 'write', { file_path: '/src/a.ts', content: 'v2' }),
      toolResult(8),
      toolCall(9, 'write', { file_path: '/src/a.ts', content: 'v1' }), // C2 restore
      toolResult(10),
      toolCall(11, 'build', { command: 'pnpm build' }),
      toolResult(12, { name: 'BuildError', code: 'E1' }),
      assistantMessage(13, 'The build failed, I will fix it now'), // C3 (after error)
      toolCall(14, 'edit', { file_path: '/src/a.ts', old_string: 'v2', new_string: 'v1' }),
      toolResult(15),
      toolCall(16, 'build', { command: 'pnpm build' }), // C1 (retry of build within 4)
      toolResult(17),
      todoWrite(18, [{ content: 'implement', status: 'completed' }]),
      todoWrite(19, [{ content: 'implement', status: 'in_progress' }]), // C4
      userMessage(20, 'wrong approach, use the other API instead'), // C5 (within 6 of seq 17? seq17 is tool/result — not an action; last action seq16 → distance 4)
    ]
    const result = classifySession(events)
    expect(result.counts).toEqual({ C1: 1, C2: 1, C3: 1, C4: 1, C5: 1 })
    expect(result.total).toBe(5)
    expect(result.toolCalls).toBe(7)
    expect(result.per100Calls).toBeCloseTo(71.43, 1)
    expect(result.hits.map(h => h.class)).toEqual(['C2', 'C3', 'C1', 'C4', 'C5'])
  })
})

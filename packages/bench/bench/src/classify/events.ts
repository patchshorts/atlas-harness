/**
 * Event loading and text/argument helpers for the bench classifier.
 *
 * All helpers are pure and deterministic: the classifier contract is that the
 * same log always yields the same counts (spec §2 — "no LLM judgment").
 *
 * @module @atlasai/atsh-bench/classify/events
 */

import { createHash } from 'node:crypto'
import type { SessionLogEvent } from './types.ts'

/** Envelope keys stripped when an event lacks a nested `data` field. */
const ENVELOPE_KEYS = new Set(['type', 'seq', 'time', 'ignorable', 'sourceEventSeqs', 'surfaceOp'])

/** A loaded session: optional id plus normalized events in ascending seq order. */
export interface LoadedSession {
  /** Session id when the input carried one (the `{ sessionId, events }` shape). */
  sessionId?: string
  /** Normalized events in ascending seq order. */
  events: SessionLogEvent[]
}

/**
 * Normalize an exported session-log JSON payload into a typed session.
 *
 * Accepted shapes (deterministic, documented in the README):
 * - a bare array of events,
 * - `{ events: [...] }`,
 * - `{ log: [...] }`,
 * - `{ sessionId, events: [...] }` (the session id is carried on the result).
 *
 * Each event must carry a non-empty `type` and a finite numeric `seq`; a
 * malformed event throws — a log the classifier cannot read must fail loudly,
 * never silently undercount.
 *
 * @param input - the parsed JSON payload.
 * @returns the loaded session.
 */
export function loadSession(input: unknown): LoadedSession {
  let raw: unknown
  let sessionId: string | undefined
  if (Array.isArray(input)) {
    raw = input
  } else if (input !== null && typeof input === 'object') {
    const obj = input as Record<string, unknown>
    const candidate = Array.isArray(obj.events) ? obj.events : Array.isArray(obj.log) ? obj.log : undefined
    if (candidate === undefined) {
      throw new TypeError('bench-classify: session log input must be an event array, { events }, { log }, or { sessionId, events }')
    }
    raw = candidate
    if (typeof obj.sessionId === 'string') sessionId = obj.sessionId
  } else {
    throw new TypeError('bench-classify: session log input must be an array or object, got ' + typeof input)
  }

  const events: SessionLogEvent[] = []
  for (const [index, entry] of (raw as unknown[]).entries()) {
    if (entry === null || typeof entry !== 'object') {
      throw new TypeError(`bench-classify: event #${index} is not an object`)
    }
    const ev = entry as Record<string, unknown>
    if (typeof ev.type !== 'string' || ev.type.length === 0) {
      throw new TypeError(`bench-classify: event #${index} is missing a non-empty "type"`)
    }
    const seq = typeof ev.seq === 'number' ? ev.seq : Number(ev.seq)
    if (!Number.isFinite(seq)) {
      throw new TypeError(`bench-classify: event #${index} (${ev.type}) is missing a finite numeric "seq"`)
    }
    const data = ev.data !== undefined && ev.data !== null && typeof ev.data === 'object'
      ? (ev.data as Record<string, unknown>)
      : stripEnvelope(ev)
    const event: SessionLogEvent = { type: ev.type, seq, data }
    if (typeof ev.time === 'number') event.time = ev.time
    events.push(event)
  }
  events.sort((a, b) => a.seq - b.seq)
  if (sessionId === undefined) return { events }
  return { sessionId, events }
}

/** Load only the event list (bare-array convenience over {@link loadSession}). */
export function loadEvents(input: unknown): SessionLogEvent[] {
  return loadSession(input).events
}

/** Build a fallback `data` object from flat event fields, dropping the envelope keys. */
function stripEnvelope(ev: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(ev)) {
    if (!ENVELOPE_KEYS.has(key)) data[key] = value
  }
  return data
}

/**
 * Extract the model-visible text from a message `content` block list.
 *
 * Only `{ type: 'text', text }` blocks are read — reasoning blocks are not
 * model-visible and never feed the lexicon match (spec §2.1 "message text").
 * A plain string content (some re-exports flatten) passes through unchanged.
 *
 * @param content - a ContentBlock[] or a raw string.
 * @returns concatenated visible text.
 */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block !== null && typeof block === 'object') {
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    }
  }
  return parts.join('\n')
}

/**
 * Parse a `tool/call` arguments JSON string. Deterministic: a malformed
 * arguments payload yields `null` and the caller skips the event — a broken
 * call cannot fabricate or destroy a correction.
 */
export function parseToolArgs(argumentsJson: unknown): Record<string, unknown> | null {
  if (typeof argumentsJson !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Stable canonical JSON serialization: recursively sorts object keys so that
 * logically identical payloads hash identically regardless of key order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) out[key] = sortKeys(item)
    }
    return out
  }
  return value
}

/** SHA-256 hex digest of a string — the C2 content hash. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

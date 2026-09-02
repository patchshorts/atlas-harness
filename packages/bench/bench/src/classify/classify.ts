/**
 * The bench classifier — deterministic C1..C5 correction-class rules over the
 * exported append-only session log (benchmark spec §2).
 *
 * No LLM judgment enters any count: every rule is a pure function of event
 * types, sequence numbers, and payload fields. The five rules (spec §2.1):
 *
 * - C1 RetriedFailedToolCall — a `tool/result` carrying `error`, followed
 *   within `c1RetryWindow` events by a `tool/call` of the same tool name.
 * - C2 RevertedFileEdit — an fs-family write whose content hash equals the
 *   content hash of an earlier write to the same path (a restore).
 * - C3 SelfCorrectionMessage — an `assistant/message` (model source only)
 *   containing a lexicon token, occurring after an erroring `tool/result` or
 *   a `todo/write` state flip.
 * - C4 RepairedPlanDeviation — a `todo/write` item whose status transitions
 *   `completed` → `in_progress`/`pending` versus the previous snapshot.
 * - C5 UserCorrection — a `user/message` <= 200 chars containing a lexicon
 *   token, within `c5AssistantWindow` events after an assistant action.
 *
 * §2.3 exclusions are structural: first-attempt failures and dead-end errors
 * never match C1 (no retry call), compaction events are their own log types
 * and any non-model assistant message is skipped, and user messages over
 * 200 chars are task prose, never corrections.
 *
 * @module @atlasai/atsh-bench/classify/classify
 */

import { DEFAULT_CONFIG } from './config.ts'
import { canonicalJson, extractText, parseToolArgs, sha256Hex } from './events.ts'
import { matchLexicon } from './lexicon.ts'
import type { ClassificationCounts, ClassificationResult, ClassifierConfig, CorrectionHit, SessionLogEvent } from './types.ts'

/** True when a `tool/result` payload carries an error object (spec §2.1 C1).
 *
 * Two wire shapes are recognized, because the classifier must read REAL
 * harness session logs, not just the synthetic fixture shape:
 *
 * 1. legacy/synthetic: a top-level `error` object on the event data
 *    (the T4 fixture shape, spec §2.1 as first written);
 * 2. real harness: `isError: true` on a `tool-result` block inside
 *    `data.message.content[]` — the deepseek-harness session-log shape,
 *    verified live on the bench workstream clone-arm exports (212/212 tool/result
 *    events carry `{type:'tool-result', toolCallId, content, isError}`;
 *    errors are marked `isError: true`, NOT a top-level `data.error`).
 *
 * Before this fix, C1/C3 gates never fired on real logs: every correction
 * count read 0 for BOTH arms regardless of actual behavior.
 */
function isErroringResult(data: Record<string, unknown>): boolean {
  const error = data.error
  if (error !== null && typeof error === 'object') return true
  // Real harness shape: message.content[] blocks of type 'tool-result'.
  const message = data.message
  if (message !== null && typeof message === 'object') {
    const content = (message as Record<string, unknown>).content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block === null || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'tool-result' && b.isError === true) return true
      }
    }
  }
  return false
}

/** First string field present in an arguments payload (path resolution for C2). */
function firstString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * The C2 payload: the file-content-bearing part of an fs-family call,
 * serialized canonically so identical writes hash identically (spec §2.1
 * "payload content-hash, no semantic diff").
 *
 * - write family: the `content` argument.
 * - edit family: the `{ old_string, new_string }` pair (or the `edits` array).
 * - str_replace_editor: the `{ old_str, new_str }` pair when present.
 */
function extractFsPayload(args: Record<string, unknown>): unknown {
  if (typeof args.content === 'string') return args.content
  if (args.edits !== undefined) return args.edits
  if (args.old_str !== undefined || args.new_str !== undefined) {
    return { old_str: args.old_str, new_str: args.new_str }
  }
  if (args.oldStr !== undefined || args.newStr !== undefined) {
    return { oldStr: args.oldStr, newStr: args.newStr }
  }
  if (args.old_string !== undefined || args.new_string !== undefined) {
    return { old_string: args.old_string, new_string: args.new_string }
  }
  return args
}

/** C1: count retried failed tool calls; return the hits. */
function classifyC1(events: readonly SessionLogEvent[], window: number): CorrectionHit[] {
  const hits: CorrectionHit[] = []
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i]
    if (ev === undefined) continue
    if (ev.type !== 'tool/result' || !isErroringResult(ev.data)) continue
    // The failed call is the most recent tool/call before this result.
    let failedName: string | undefined
    for (let back = i - 1; back >= 0; back -= 1) {
      const prior = events[back]
      if (prior !== undefined && prior.type === 'tool/call') {
        const name = prior.data.name
        if (typeof name === 'string') failedName = name
        break
      }
    }
    if (failedName === undefined) continue
    const limit = Math.min(events.length - 1, i + window)
    for (let j = i + 1; j <= limit; j += 1) {
      const retry = events[j]
      if (retry !== undefined && retry.type === 'tool/call' && retry.data.name === failedName) {
        hits.push({
          class: 'C1',
          seq: retry.seq,
          note: `retry of ${failedName} within ${window} events of erroring result (seq ${ev.seq})`,
        })
        break
      }
    }
  }
  return hits
}

/** C2: count restored file writes (content-hash equality per path). */
function classifyC2(
  events: readonly SessionLogEvent[],
  writeFamily: readonly string[],
  editFamily: readonly string[],
): CorrectionHit[] {
  const family = new Set<string>([...writeFamily, ...editFamily])
  const seenHashes = new Map<string, Set<string>>()
  const hits: CorrectionHit[] = []
  for (const ev of events) {
    if (ev.type !== 'tool/call' || !family.has(ev.data.name as string)) continue
    const args = parseToolArgs(ev.data.arguments)
    if (args === null) continue
    const path = firstString(args, ['file_path', 'filePath', 'path'])
    if (path === undefined) continue
    const payload = extractFsPayload(args)
    const hash = sha256Hex(canonicalJson(payload))
    let prior = seenHashes.get(path)
    if (prior === undefined) {
      prior = new Set<string>()
      seenHashes.set(path, prior)
    }
    if (prior.has(hash)) {
      hits.push({ class: 'C2', seq: ev.seq, note: `restore of ${path} to earlier content` })
    }
    prior.add(hash)
  }
  return hits
}

/** C3 + C4 + C5 share one forward pass over shared session state. */
function classifyC345(
  events: readonly SessionLogEvent[],
  config: ClassifierConfig,
): CorrectionHit[] {
  const hits: CorrectionHit[] = []
  let sawErrorOrFlip = false
  let lastActionSeq = -Infinity
  const prevByContent = new Map<string, string>()

  for (const ev of events) {
    if (ev.type === 'tool/result' && isErroringResult(ev.data)) {
      sawErrorOrFlip = true
    } else if (ev.type === 'todo/write') {
      // C4 counts flips against the PREVIOUS snapshot; only then does the
      // snapshot advance (last-write-wins, spec §2.1 C4).
      const todos = Array.isArray(ev.data.todos) ? ev.data.todos : []
      for (const item of todos) {
        if (item === null || typeof item !== 'object') continue
        const content = String((item as Record<string, unknown>).content)
        const status = String((item as Record<string, unknown>).status)
        const prev = prevByContent.get(content)
        if (prev === 'completed' && (status === 'in_progress' || status === 'pending')) {
          sawErrorOrFlip = true
          hits.push({ class: 'C4', seq: ev.seq, note: `todo "${content}" flipped completed -> ${status}` })
        }
      }
      prevByContent.clear()
      for (const item of todos) {
        if (item === null || typeof item !== 'object') continue
        const content = String((item as Record<string, unknown>).content)
        const status = String((item as Record<string, unknown>).status)
        prevByContent.set(content, status)
      }
    }

    if (ev.type === 'assistant/message' || ev.type === 'tool/call') {
      lastActionSeq = ev.seq
    }

    if (ev.type === 'assistant/message') {
      const message = ev.data.message
      // §2.3: compaction summaries are their own log event types; a
      // non-model assistant message (future summarizer kinds) is never a
      // self-correction message.
      const source = (message as Record<string, unknown> | undefined)?.source as Record<string, unknown> | undefined
      if (source !== undefined && source.kind !== undefined && source.kind !== 'model') continue
      const content = (message as Record<string, unknown> | undefined)?.content
      const text = extractText(content)
      if (sawErrorOrFlip && matchLexicon(text, config.lexicon)) {
        hits.push({
          class: 'C3',
          seq: ev.seq,
          note: 'assistant message with correction token after erroring result or todo flip',
        })
      }
    } else if (ev.type === 'user/message') {
      const text = extractText(ev.data.content)
      if (text.length > config.userMessageMaxChars) continue
      if (lastActionSeq !== -Infinity && ev.seq - lastActionSeq <= config.c5AssistantWindow
        && matchLexicon(text, config.lexicon)) {
        hits.push({
          class: 'C5',
          seq: ev.seq,
          note: `user correction (${text.length} chars) within ${config.c5AssistantWindow} events of assistant action`,
        })
      }
    }
  }
  return hits
}

/**
 * Classify one session log into C1..C5 correction counts.
 *
 * Deterministic: the same events + config always produce the same result.
 *
 * @param events - normalized session log events (see {@link loadEvents}).
 * @param config - partial config; defaults mirror the frozen manifest.
 * @returns per-class counts, totals, and evidence hits.
 */
export function classifySession(events: readonly SessionLogEvent[], config: Partial<ClassifierConfig> = {}): ClassificationResult {
  const cfg: ClassifierConfig = { ...DEFAULT_CONFIG, ...config }
  const hits = [
    ...classifyC1(events, cfg.c1RetryWindow),
    ...classifyC2(events, cfg.fsWriteFamily, cfg.fsEditFamily),
    ...classifyC345(events, cfg),
  ].sort((a, b) => a.seq - b.seq)

  const counts: ClassificationCounts = { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0 }
  for (const hit of hits) counts[hit.class] += 1
  const total = counts.C1 + counts.C2 + counts.C3 + counts.C4 + counts.C5
  const toolCalls = events.filter(event => event.type === 'tool/call').length

  return {
    events: events.length,
    toolCalls,
    counts,
    total,
    per100Calls: toolCalls > 0 ? Math.round((total / toolCalls) * 10000) / 100 : 0,
    hits,
  }
}

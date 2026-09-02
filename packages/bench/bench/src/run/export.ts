/**
 * Pure helpers for the bench runner's session-log export: read the
 * plain-JSONL session log produced by the harness's JSONL persistence
 * backend (compression `none`, `packChunks: false` — forced by the bench
 * home patch, spec §5) and extract provider-reported token usage.
 *
 * All functions are synchronous, dependency-free, and unit-testable without
 * spawning anything.
 *
 * @module @atlasai/atsh-bench/run/export
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionLogEvent } from '../classify/types.ts'

/**
 * Token accounting for one model call — mirrors `dsh-llm` `TokenUsage`.
 * Counts are DISJOINT: `inputTokens` is uncached input only; cached input is
 * reported separately as `cacheReadTokens`/`cacheWriteTokens` (billed input
 * = sum of the three). Fields may be absent on wire surfaces; the sidecar
 * treats absent fields as 0.
 */
export interface TokenUsageSurface {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** A parsed usage sample with the "was usage present at all" signal. */
export interface ParsedTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** False when the event carries no TokenUsage at all (data-quality flag, spec §7). */
  hasTokenUsage: boolean
}

/** A session log as exported: header session id (when present) + events. */
export interface LoadedSessionLog {
  sessionId?: string
  events: SessionLogEvent[]
}

/**
 * Extract the TokenUsage an event reports, from BOTH wire surfaces (spec §7):
 * `assistant/message` → `event.data.usage`; `assistant/chunk` → only when
 * `chunk.type === 'usage'` → `event.data.chunk.usage`. Anything else reports
 * no usage. The rule mirrors the token-meter projection's `usageOf()`.
 *
 * @param event - one session-log event.
 * @returns parsed disjoint token counts; absent fields become 0.
 */
export function parseTokenUsage(event: SessionLogEvent): ParsedTokenUsage {
  let usage: TokenUsageSurface | undefined
  if (event.type === 'assistant/message') {
    usage = (event.data as { usage?: TokenUsageSurface }).usage
  } else if (event.type === 'assistant/chunk') {
    const chunk = (event.data as { chunk?: { type?: string; usage?: TokenUsageSurface } }).chunk
    if (chunk?.type === 'usage') usage = chunk.usage
  }
  if (usage === undefined) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, hasTokenUsage: false }
  }
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    hasTokenUsage: true,
  }
}

/**
 * Read a plain-JSONL session log: first line is the header record
 * (`{type: 'session', id, ...}`), every following line is one event, stored
 * exactly as written (`type`/`seq`/`time`/`data` preserved). Tolerant of a
 * trailing newline and blank lines.
 *
 * @param path - the `session.jsonl` file.
 * @returns `{ sessionId, events }`, or `null` when the file does not exist.
 */
export function readSessionLogFile(path: string): LoadedSessionLog | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const lines = raw.split('\n').filter(line => line.trim() !== '')
  if (lines.length === 0) return { events: [] }
  const header = JSON.parse(lines[0] as string) as { id?: unknown }
  const sessionId = typeof header.id === 'string' ? header.id : undefined
  const events: SessionLogEvent[] = []
  for (const line of lines.slice(1)) {
    events.push(JSON.parse(line) as SessionLogEvent)
  }
  return { ...sessionId === undefined ? {} : { sessionId }, events }
}

/**
 * Find the newest `session.jsonl` under a bench `ATSH_HOME` — the JSONL
 * backend writes them at `<root>/sessions/<project-key>/<session-id>/session.jsonl`.
 *
 * @param atshHome - the fresh per-session home directory.
 * @returns absolute path of the newest session log, or `null` when none exists.
 */
export function findNewestSessionLog(atshHome: string): string | null {
  const sessionsRoot = join(atshHome, 'sessions')
  let projects: string[]
  try {
    projects = readdirSync(sessionsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => join(sessionsRoot, entry.name))
  } catch {
    return null
  }
  let newest: string | null = null
  let newestMtime = 0
  for (const projectDir of projects) {
    let sessionDirs: string[]
    try {
      sessionDirs = readdirSync(projectDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => join(projectDir, entry.name))
    } catch {
      continue
    }
    for (const sessionDir of sessionDirs) {
      const candidate = join(sessionDir, 'session.jsonl')
      let mtime: number
      try {
        mtime = statSync(candidate).mtimeMs
      } catch {
        continue
      }
      if (newest === null || mtime > newestMtime) {
        newest = candidate
        newestMtime = mtime
      }
    }
  }
  return newest
}

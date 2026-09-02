// PromptArmor-pattern sanitization pass — deterministic, zero LLM: strips
// directive markers, encoded blobs, and marker-spoof line prefixes from
// untrusted text (typically tool output) BEFORE it enters context. The
// caller wires the pass; this package proves it. String operations are
// immutable — sanitize always returns a NEW string (golden rule).

import type { SanitizeHit, SanitizeResult } from './types.ts'

/**
 * The curated directive marker list (case-insensitive substring match).
 * A conservative, deterministic approximation of PromptArmor's strip-pass
 * (the <1% FP/FN AgentDojo figure is model-backed; this set is conservative
 * and deterministic).
 */
export const INJECTION_MARKERS: readonly string[] = [
  'ignore previous instructions',
  'ignore all previous instructions',
  'ignore your instructions',
  'disregard',
  'forget your instructions',
  'you are now',
  'act as',
  'system prompt',
  'system instructions',
  'override all',
  'jailbreak',
  'do not follow',
  'reveal your',
  'print your system',
  'follow these instructions',
  'you must execute',
  'highest priority',
  'new instructions',
  'this message overrides',
  'do not treat',
]

/**
 * Marker-spoof line prefixes. A line that STARTS with one of these
 * (case-insensitive, optional leading 'LANE N — ' prefix) is a spoof
 * attempt; the spoofed prefix segment is stripped.
 */
export const SPOOF_PREFIXES: readonly string[] = [
  'lane 1',
  'system:',
  'system instruction:',
  'user:',
  'assistant:',
]

/**
 * Remove text from fromIndex to the end of the current sentence (the next
 * `.`, `!`, `?`, or newline, or the end of the text).
 *
 * @param text - the source text.
 * @param fromIndex - the strip start (char index).
 * @returns the shortened text.
 */
export function stripSentence(text: string, fromIndex: number): string {
  const rest = text.slice(fromIndex)
  const terminator = /[.!?\n]/.exec(rest)
  const cut = terminator === null ? text.length : fromIndex + terminator.index + 1
  return text.slice(0, fromIndex) + text.slice(cut)
}

/** Any run of >= 24 base64-alphabet chars with no spaces is an encoded blob. */
const ENCODED_BLOB = /[A-Za-z0-9+/=]{24,}/g

/** Strip the spoofed prefix segment from one line, when the line is a spoof. */
function stripSpoofLine(line: string): { line: string; hit: string | null; prefixLength: number } {
  const lane = /^lane\s+\d+\s*[-\u2013\u2014]\s*/i.exec(line)
  const lanePrefix = lane?.[0] ?? ''
  const rest = lanePrefix === '' ? line : line.slice(lanePrefix.length)
  const lower = rest.toLowerCase()
  for (const prefix of SPOOF_PREFIXES) {
    if (lower.startsWith(prefix)) {
      const prefixLength = lanePrefix.length + prefix.length
      return { line: line.slice(prefixLength), hit: prefix, prefixLength }
    }
  }
  return { line, hit: null, prefixLength: 0 }
}

/**
 * Strip injected prompts from untrusted text (PromptArmor pattern, no LLM).
 * Single left-to-right pass, iterated until no rule fires (max 5 passes — a
 * pathological input must terminate): (a) encoded-blob rule — any run of
 * >= 24 base64-alphabet chars is stripped; (b) directive markers — the
 * marker opens an injection tail, so the text from the marker to the end is
 * stripped (the directive body follows the trigger sentence — the empirical
 * in-band payloads carry the action after the marker); (c) spoof-prefix rule
 * per line — a line starting with a spoofed lane/system prefix has that
 * segment stripped.
 *
 * @param text - the raw untrusted text (typically tool output).
 * @param markers - the marker list to strip (defaults to INJECTION_MARKERS).
 * @returns the sanitized text, the strip hits, and the total chars removed.
 */
export function sanitize(text: string, markers: readonly string[] = INJECTION_MARKERS): SanitizeResult {
  let current = text
  const hits: SanitizeHit[] = []
  let stripped = 0

  for (let pass = 0; pass < 5; pass++) {
    let changed = false

    // (a) encoded blobs
    ENCODED_BLOB.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = ENCODED_BLOB.exec(current)) !== null) {
      const blob = match[0]
      hits.push({ index: match.index, marker: 'encoded:base64' })
      current = current.slice(0, match.index) + current.slice(match.index + blob.length)
      stripped += blob.length
      changed = true
      ENCODED_BLOB.lastIndex = match.index
    }

    // (b) directive markers — cut the injection tail
    let markerIndex = -1
    let markerName = ''
    const lowerText = current.toLowerCase()
    for (const marker of markers) {
      const lower = marker.toLowerCase()
      const idx = lowerText.indexOf(lower)
      if (idx >= 0) {
        markerIndex = idx
        markerName = lower
        break
      }
    }
    if (markerIndex >= 0) {
      hits.push({ index: markerIndex, marker: `marker:${markerName}` })
      stripped += current.length - markerIndex
      current = current.slice(0, markerIndex)
      changed = true
    }

    // (c) spoof prefixes per line
    if (!changed) {
      const lines = current.split('\n')
      let offset = 0
      const out: string[] = []
      for (const line of lines) {
        const result = stripSpoofLine(line)
        if (result.hit !== null) {
          hits.push({ index: offset, marker: `spoof:${result.hit.toLowerCase()}` })
          stripped += result.prefixLength
          out.push(result.line)
          changed = true
        } else {
          out.push(line)
        }
        offset += line.length + 1
      }
      if (changed) current = out.join('\n')
    }

    if (!changed) break
  }

  return { text: current.trim(), hits, stripped }
}

/**
 * Alias of sanitize() kept for the PromptArmor vocabulary: the caller
 * applies this pass to tool output before it enters context.
 *
 * @param text - the tool output text.
 * @returns the sanitized text, the strip hits, and the total chars removed.
 */
export function sanitizeToolOutput(text: string): SanitizeResult {
  return sanitize(text)
}

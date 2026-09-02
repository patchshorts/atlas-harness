// Pure deterministic markdown → task parser for the judge gate.
//
// The parser extracts atomic task rows from a plan artifact (the factory L5
// row format): `N. [verb] object — verifies: check` and the extended
// `N. [verb] object — output — ∥ — verifies: check` form (the `∥` / `⧖`
// markers and the output segment are ignored, never treated as the object).
// Rows that do not match the row pattern (headings, prose) are skipped;
// matched rows are kept even when a field is empty so the decomposition vote
// can flag the exact missing piece. Deterministic: same markdown → same
// tasks, byte-stable. The parser never fabricates fields.

import type { JudgePlanTask } from '@atlasai/atsh-factory-judge'

/** A plan row: ordinal, bracket verb, and the remainder of the line. */
const TASK_ROW = /^\s*(\d+)\.\s*\[([^\]]+)\](.*)$/

/** The object is everything between ']' and the first '—' (em dash). */
function takeObject(rest: string): string {
  const dash = rest.indexOf('—')
  return (dash === -1 ? rest : rest.slice(0, dash)).trim()
}

/** The verifies is the text after the LAST `verifies` (or `verifies:`) marker. */
function takeVerifies(rest: string): string {
  const marker = /\bverifies\s*:?\s*/g
  let match: RegExpExecArray | null
  let start = -1
  while ((match = marker.exec(rest)) !== null) {
    start = match.index + match[0].length
  }
  return start === -1 ? '' : rest.slice(start).trim()
}

/**
 * Parse the atomic task rows of a plan artifact into JudgePlanTask rows.
 *
 * Each matching row yields exactly one task with id `T<ordinal>` (the row's
 * own ordinal — the parser does not renumber gaps), the bracket verb, the
 * object up to the first em dash, and the verifies after the last `verifies`
 * marker. A row that matches the pattern but carries an empty field is kept
 * as-is so the decomposition vote names the missing piece; a row that does
 * not match the pattern is skipped.
 *
 * @param markdown - the plan artifact exactly as presented.
 * @returns the parsed tasks, in row order.
 */
export function parsePlanTasks(markdown: string): JudgePlanTask[] {
  const tasks: JudgePlanTask[] = []
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim()
    const match = TASK_ROW.exec(line)
    if (!match) continue
    // The pattern guarantees three groups; strict indexing types them as
    // possibly undefined, so assert the guaranteed captures.
    const ordinal = match[1]!
    const verb = match[2]!.trim()
    const rest = match[3]!
    tasks.push({
      id: `T${ordinal}`,
      verb,
      object: takeObject(rest),
      verifies: takeVerifies(rest),
    })
  }
  return tasks
}

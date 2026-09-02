/**
 * Self-targeted tests for the bench overnight self-patch.
 *
 * Verifies (self-targeted fast spec — deferred-verification contract, no
 * full-suite run):
 * 1. The overnight-patch READ path consumes a REAL session-log fixture — a
 *    plain-JSONL file written to a temp dir (same shape as `readSessionLogFile`
 *    parses), not mocks. loadSessionDirectory reads every `session.jsonl`;
 *    clusterLogs classifies each session with the real classifier and clusters
 *    the corrections.
 * 2. clusterCorrections groups hits by class + tool token, so the same tool
 *    that recurs across sessions forms ONE cluster with an accurate count;
 *    a tool seen once stays a count-1 cluster.
 * 3. correctionClusterToken extracts the tool/path from the classifier note.
 * 4. draftOvernightHelp renders a deterministic SKILL.md-style block naming
 *    the recurring clusters and the proposed mitigation.
 * 5. The run-end coordinator writes the artifact to a real file path.
 *
 * Mirror of the classify.spec + mistake-ledger.spec patterns. Fixtures are
 * REAL session.jsonl files exercised through the actual plain-JSONL reader.
 *
 * @module @atlasai/atsh-bench/overnight-patch.spec
 */

import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clusterCorrections,
  clusterLogs,
  correctionClusterToken,
  draftOvernightHelp,
  loadSessionDirectory,
  writeOvernightPatchArtifact,
} from '../src/index.ts'
import type { CorrectionHit } from '../src/classify/types.ts'

/** A harness-shaped session-log event (mirrors classify.ts wire shapes). */
function sessionEvent(type: string, seq: number, data: Record<string, unknown>) {
  return { type, seq, time: 1_700_000_000_000 + seq, data }
}

/** A `tool/call` event with a JSON-stringified arguments payload. */
function sessionToolCall(seq: number, name: string, args: Record<string, unknown>) {
  return sessionEvent('tool/call', seq, {
    turn: 1,
    step: 1,
    callId: `call-${seq}`,
    name,
    arguments: JSON.stringify(args),
  })
}

/** A REAL harness-shape erroring result. */
function sessionErrorResult(seq: number) {
  return sessionEvent('tool/result', seq, {
    turn: 1,
    step: 1,
    message: {
      source: { kind: 'tool', callId: `call-${seq}` },
      content: [
        {
          type: 'tool-result',
          toolCallId: `call-${seq}`,
          isError: true,
          content: [{ type: 'text', text: 'Error: command failed with exit code 1' }],
        },
      ],
    },
  })
}

/** Write a plain-JSONL session-log fixture file: header + events. */
function writeSessionFixture(dir: string, name: string, events: Array<object>): void {
  const header = JSON.stringify({ type: 'session', id: name.replace(/\.jsonl$/, '') })
  const lines = [header, ...events.map(event => JSON.stringify(event))]
  writeFileSync(join(dir, name), lines.join('\n') + '\n', 'utf8')
}

/** A correction hit in the classifier's wire shape. */
function hit(classId: 'C1' | 'C2' | 'C3' | 'C4' | 'C5', note: string, seq: number): CorrectionHit {
  return { class: classId, seq, note }
}

describe('overnight-patch — real session-log fixture clustering', () => {
  it('loads the fixture dir and clusters recurring C1 corrections by tool', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-overnight-logs-'))
    try {
      // Two sessions with the SAME failing bash tool → the C1 retry recurs.
      writeSessionFixture(dir, 'arm-a.jsonl', [
        sessionToolCall(1, 'bash', { command: 'x' }),
        sessionErrorResult(2),
        sessionToolCall(3, 'bash', { command: 'x' }),
        sessionToolCall(4, 'bash', { command: 'x' }),
        sessionErrorResult(5),
        sessionToolCall(6, 'bash', { command: 'x' }),
      ])
      writeSessionFixture(dir, 'arm-b.jsonl', [
        sessionToolCall(1, 'bash', { command: 'x' }),
        sessionErrorResult(2),
        sessionToolCall(3, 'bash', { command: 'x' }),
      ])

      const sessions = loadSessionDirectory(dir)
      expect(sessions).toHaveLength(2)
      const clusters = clusterLogs(sessions)
      // bash C1 recurred 3 times across the two sessions (2 + 1).
      const bash = clusters.find(c => c.key === 'C1:bash')
      expect(bash).toBeDefined()
      expect(bash?.count).toBe(3)
      expect(bash?.sampleNote).toContain('bash')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('overnight-patch — clusterCorrections + correctionClusterToken', () => {
  it('groups the same class+token into one cluster and counts recurrence', () => {
    const clusters = clusterCorrections([
      hit('C1', 'retry of bash within 5 events of erroring result (seq 1)', 1),
      hit('C1', 'retry of bash within 5 events of erroring result (seq 4)', 4),
      hit('C1', 'retry of read2 within 5 events of erroring result (seq 9)', 9),
    ])
    expect(clusters).toHaveLength(2)
    expect(clusters.find(c => c.key === 'C1:bash')?.count).toBe(2)
    expect(clusters.find(c => c.key === 'C1:read2')?.count).toBe(1)
  })

  it('extracts the tool/path token from the classifier note', () => {
    expect(correctionClusterToken(hit('C1', 'retry of writeFile within 5 events', 1))).toBe('writeFile')
    expect(correctionClusterToken(hit('C2', 'restore of /tmp/foo to earlier content', 2))).toBe('/tmp/foo')
  })
})

describe('overnight-patch — artifact draft + write', () => {
  it('drafts a deterministic SKILL.md-style block naming the recurring cluster', () => {
    const cluster = { key: 'C1:bash', class: 'C1', token: 'bash', count: 3, sampleNote: 'retry of bash' }
    const text = draftOvernightHelp([cluster])
    expect(text).toContain('# SKILL.md (drafted)')
    expect(text).toContain('"bash" recurred 3x')
    expect(text).toContain('mistake ledger')
  })

  it('writes the run-end artifact to a real file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-overnight-artifact-'))
    const cluster = { key: 'C1:bash', class: 'C1', token: 'bash', count: 3, sampleNote: 'retry of bash' }
    const artifact = writeOvernightPatchArtifact([cluster], dir, 'overnight.md')
    expect(existsSync(artifact)).toBe(true)
    expect(artifact.endsWith('overnight.md')).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

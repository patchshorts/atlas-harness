/**
 * Unit tests for `bench-audit` — the classifier second-pass audit (spec
 * §6.4): per-arm agreement over fixture session logs + counts artifacts,
 * tamper detection, missing-log handling, rendering, and the audit CLI
 * end-to-end.
 *
 * Fixtures are built in a temp dir: each session is a JSONL log
 * (`{"type":"session","id":...}` header + `{type, seq, time, data}` events)
 * written at `<root>/session-logs/<arm>/<taskId>.jsonl` (one task id per arm
 * contains '/' to exercise the nested-path branch), and the counts artifact
 * is derived FROM `classifySession(events)` so the recorded (first pass)
 * counts equal ground truth by construction.
 *
 * @module @atlasai/atsh-bench/audit.spec
 */

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auditArm,
  auditCli,
  buildAuditReport,
  classifySession,
  DEFAULT_CONFIG,
  parseAuditCli,
  renderAuditJson,
  renderAuditMarkdown,
} from '../src/index.ts'
import type { AuditReport, CountsArtifact, CountsSession, SessionLogEvent } from '../src/index.ts'

const MANIFEST_FIXTURE = fileURLToPath(new URL('./fixtures/bench-manifest.fixture.json', import.meta.url))

/** One user/assistant text block, as produced by the harness. */
const textBlock = (text: string) => ({ type: 'text', text })

/** A harness-shaped event. */
function event(type: string, seq: number, data: Record<string, unknown>): SessionLogEvent {
  return { type, seq, time: 1_700_000_000_000 + seq, data }
}

const toolCall = (seq: number, name: string, args: Record<string, unknown>): SessionLogEvent =>
  event('tool/call', seq, { turn: 1, step: 1, callId: `call-${seq}`, name, arguments: JSON.stringify(args) })

const toolResult = (seq: number, error?: { name: string; code: string }): SessionLogEvent =>
  event('tool/result', seq, { turn: 1, step: 1, message: { id: 'm', role: 'user', content: [] }, error })

const assistantMessage = (seq: number, text: string): SessionLogEvent =>
  event('assistant/message', seq, {
    turn: 1,
    step: 1,
    message: { id: `a-${seq}`, role: 'assistant', content: [textBlock(text)], source: { kind: 'model', provider: 'deepseek', model: 'x' } },
  })

const userMessage = (seq: number, text: string): SessionLogEvent =>
  event('user/message', seq, { id: `u-${seq}`, role: 'user', content: [textBlock(text)], source: { kind: 'user' } })

const todoWrite = (seq: number, todos: Array<{ content: string; status: string }>): SessionLogEvent =>
  event('todo/write', seq, { todos })

/** One fixture session: events that classify to the documented counts. */
interface FixtureSession {
  taskId: string
  sessionId: string
  /** Expected first-pass counts — asserted in TEST 1 to pin the fixtures. */
  expected: { C1: number; C2: number; C3: number; C4: number; C5: number }
  events: SessionLogEvent[]
}

/** The 5 clone sessions: varied counts, one nested task id, one empty, one all-five. */
const CLONE_SESSIONS: FixtureSession[] = [
  {
    taskId: 'audit-clone-1',
    sessionId: 'clone-s1',
    expected: { C1: 1, C2: 0, C3: 1, C4: 0, C5: 0 },
    events: [
      toolCall(1, 'build', { command: 'x' }),
      toolResult(2, { name: 'Error', code: 'E1' }),
      toolCall(3, 'build', { command: 'x' }), // C1 retry
      toolCall(4, 'test', { command: 'y' }),
      toolResult(5, { name: 'Error', code: 'E2' }),
      assistantMessage(6, 'I made a mistake, let me fix this'), // C3 (after error, 'mistake')
    ],
  },
  {
    taskId: 'terminal-bench/bun-sourcemap-leak', // '/' nests the log path
    sessionId: 'clone-s2',
    expected: { C1: 0, C2: 1, C3: 0, C4: 0, C5: 0 },
    events: [
      toolCall(1, 'tool:write', { file_path: '/src/a.ts', content: 'v1' }),
      toolCall(2, 'tool:write', { file_path: '/src/a.ts', content: 'v2' }),
      toolCall(3, 'tool:write', { file_path: '/src/a.ts', content: 'v1' }), // C2 restore
    ],
  },
  {
    taskId: 'audit-clone-3',
    sessionId: 'clone-s3',
    expected: { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0 }, // empty — no corrections
    events: [
      assistantMessage(1, 'starting the task'),
      toolCall(2, 'read', { file_path: '/a' }),
      toolResult(3),
    ],
  },
  {
    taskId: 'audit-clone-4',
    sessionId: 'clone-s4',
    expected: { C1: 1, C2: 1, C3: 1, C4: 1, C5: 1 }, // all five (realistic mixed session)
    events: [
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
      assistantMessage(13, 'The build failed, I will fix it now'), // C3
      toolCall(14, 'edit', { file_path: '/src/a.ts', old_string: 'v2', new_string: 'v1' }),
      toolResult(15),
      toolCall(16, 'build', { command: 'pnpm build' }), // C1 retry
      toolResult(17),
      todoWrite(18, [{ content: 'implement', status: 'completed' }]),
      todoWrite(19, [{ content: 'implement', status: 'in_progress' }]), // C4
      userMessage(20, 'wrong approach, use the other API instead'), // C5
    ],
  },
  {
    taskId: 'audit-clone-5',
    sessionId: 'clone-s5',
    expected: { C1: 0, C2: 0, C3: 2, C4: 0, C5: 0 }, // two C3s, no cross-class leakage
    events: [
      toolCall(1, 'bash', { command: 'x' }),
      toolResult(2, { name: 'Error', code: 'E1' }),
      assistantMessage(3, 'sorry, let me redo this'), // C3 ('sorry')
      toolCall(4, 'build', { command: 'y' }),
      toolResult(5, { name: 'Error', code: 'E2' }),
      assistantMessage(6, 'I need to roll back and fix it'), // C3 ('roll back')
    ],
  },
]

/** The 5 additive sessions: varied counts, one nested task id, two C4s. */
const ADDITIVE_SESSIONS: FixtureSession[] = [
  {
    taskId: 'audit-add-1',
    sessionId: 'add-s1',
    expected: { C1: 0, C2: 1, C3: 0, C4: 0, C5: 0 },
    events: [
      toolCall(1, 'write', { file_path: '/a', content: 'v1' }),
      toolCall(2, 'write', { file_path: '/a', content: 'v2' }),
      toolCall(3, 'write', { file_path: '/a', content: 'v1' }), // C2 restore
    ],
  },
  {
    taskId: 'audit-add-2',
    sessionId: 'add-s2',
    expected: { C1: 1, C2: 0, C3: 0, C4: 0, C5: 1 },
    events: [
      toolCall(1, 'build', { command: 'x' }),
      toolResult(2, { name: 'Error', code: 'E1' }),
      toolCall(3, 'build', { command: 'x' }), // C1 retry
      assistantMessage(4, 'here is the patch'),
      userMessage(5, 'no, that is wrong — redo it'), // C5 ('wrong', 1 event after action)
    ],
  },
  {
    taskId: 'terminal-bench/pty-login', // '/' nests the log path
    sessionId: 'add-s3',
    expected: { C1: 0, C2: 0, C3: 1, C4: 0, C5: 0 },
    events: [
      toolCall(1, 'build', { command: 'x' }),
      toolResult(2, { name: 'Error', code: 'E1' }),
      assistantMessage(3, 'that failed, I will redo this differently'), // C3 ('that failed')
    ],
  },
  {
    taskId: 'audit-add-4',
    sessionId: 'add-s4',
    expected: { C1: 0, C2: 0, C3: 0, C4: 1, C5: 0 },
    events: [
      todoWrite(1, [{ content: 'task A', status: 'completed' }]),
      todoWrite(2, [{ content: 'task A', status: 'in_progress' }]), // C4 flip
    ],
  },
  {
    taskId: 'audit-add-5',
    sessionId: 'add-s5',
    expected: { C1: 0, C2: 0, C3: 0, C4: 2, C5: 0 },
    events: [
      todoWrite(1, [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'completed' },
      ]),
      todoWrite(2, [
        { content: 'a', status: 'in_progress' },
        { content: 'b', status: 'pending' },
      ]), // C4 x2
    ],
  },
]

/** Build one arm's logs + counts artifact in the fixture root. */
function writeArm(root: string, arm: 'clone' | 'additive', sessions: readonly FixtureSession[]): void {
  const logsDir = join(root, 'session-logs', arm)
  const rows: CountsSession[] = []
  for (const fixture of sessions) {
    const logPath = join(logsDir, `${fixture.taskId}.jsonl`)
    mkdirSync(dirname(logPath), { recursive: true })
    const lines = [JSON.stringify({ type: 'session', id: fixture.sessionId }), ...fixture.events.map(line => JSON.stringify(line))]
    writeFileSync(logPath, `${lines.join('\n')}\n`)
    const result = classifySession(fixture.events)
    rows.push({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      exitCode: 0,
      timedOut: false,
      taskSuccess: true,
      events: result.events,
      toolCalls: result.toolCalls,
      counts: result.counts,
      total: result.total,
      per100Calls: result.per100Calls,
      hits: result.hits,
    })
  }
  const artifact: CountsArtifact = {
    arm,
    run: '2026-08-16T06:00:00.000Z',
    sessions: rows,
    meanCorrections: rows.reduce((sum, row) => sum + row.total, 0) / rows.length,
    per100Calls: rows.reduce((sum, row) => sum + row.per100Calls, 0) / rows.length,
    successRate: 1,
  }
  writeFileSync(join(root, `counts-${arm}.json`), JSON.stringify(artifact))
}

/** Build a complete clean fixture tree; returns the root + both arm dirs. */
function buildFixture(): { root: string; cloneDir: string; additiveDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'bench-audit-fixture-'))
  const cloneDir = join(root, 'clone')
  const additiveDir = join(root, 'additive')
  mkdirSync(cloneDir)
  mkdirSync(additiveDir)
  writeArm(cloneDir, 'clone', CLONE_SESSIONS)
  writeArm(additiveDir, 'additive', ADDITIVE_SESSIONS)
  return { root, cloneDir, additiveDir }
}

// ---------------------------------------------------------------------------
// TEST 1 — clean fixtures audit at exactly 1.0 agreement
// ---------------------------------------------------------------------------

describe('bench-audit auditArm — clean fixtures', () => {
  it('reports 1.0 agreement, sessionsAgree 1, and 5/5 classMatches per row', () => {
    const { root, cloneDir, additiveDir } = buildFixture()
    try {
      const cloneArm = auditArm(join(cloneDir, 'session-logs', 'clone'), cloneDir, 'clone', DEFAULT_CONFIG)
      expect(cloneArm.agreement).toBe(1)
      expect(cloneArm.sessionsAgree).toBe(1)
      expect(cloneArm.classCells).toBe(25)
      expect(cloneArm.matchedCells).toBe(25)
      expect(cloneArm.missingLogs).toEqual([])
      expect(cloneArm.sessions.every(row => row.logFound && row.classMatches === 5)).toBe(true)
      // The nested task id (contains '/') resolved through the nested log path.
      const nested = cloneArm.sessions.find(row => row.taskId === 'terminal-bench/bun-sourcemap-leak')!
      expect(nested.logFound).toBe(true)
      expect(nested.reclassified).toEqual(nested.recorded)
      const additiveArm = auditArm(join(additiveDir, 'session-logs', 'additive'), additiveDir, 'additive', DEFAULT_CONFIG)
      expect(additiveArm.agreement).toBe(1)
      expect(additiveArm.sessionsAgree).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fixture sessions classify to the documented expected counts', () => {
    for (const fixture of CLONE_SESSIONS) {
      expect(classifySession(fixture.events).counts).toEqual(fixture.expected)
    }
    for (const fixture of ADDITIVE_SESSIONS) {
      expect(classifySession(fixture.events).counts).toEqual(fixture.expected)
    }
  })

  it('buildAuditReport: overall 1.0, pass true, target 0.95, per-class cells all matched', () => {
    const { root, cloneDir, additiveDir } = buildFixture()
    try {
      const report = buildAuditReport(cloneDir, additiveDir)
      expect(report.overall).toBe(1)
      expect(report.pass).toBe(true)
      expect(report.target).toBe(0.95)
      expect(report.arms).toHaveLength(2)
      expect(report.perClass).toEqual({
        C1: { cells: 10, matched: 10 },
        C2: { cells: 10, matched: 10 },
        C3: { cells: 10, matched: 10 },
        C4: { cells: 10, matched: 10 },
        C5: { cells: 10, matched: 10 },
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('buildAuditReport with a manifest path uses the frozen lexicon and still agrees', () => {
    const { root, cloneDir, additiveDir } = buildFixture()
    try {
      const report = buildAuditReport(cloneDir, additiveDir, MANIFEST_FIXTURE)
      expect(report.overall).toBe(1)
      expect(report.pass).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// TEST 2 — tamper detection: recorded counts that disagree with the log truth
// ---------------------------------------------------------------------------

describe('bench-audit tamper detection', () => {
  it('3 mismatched cells in one session drop overall to 0.94 < 0.95 and fail the audit', () => {
    const { root, cloneDir, additiveDir } = buildFixture()
    try {
      const countsPath = join(cloneDir, 'counts-clone.json')
      const artifact = JSON.parse(readFileSync(countsPath, 'utf8')) as CountsArtifact
      const tampered = artifact.sessions.find(row => row.taskId === 'audit-clone-1')!
      tampered.counts = { C1: 0, C2: 1, C3: 0, C4: 0, C5: 0 } // truth is C1:1, C2:0, C3:1
      writeFileSync(countsPath, JSON.stringify(artifact))

      const report = buildAuditReport(cloneDir, additiveDir)
      // 10 sessions x 5 cells = 50; 3 mismatched cells -> 47/50 = 0.94.
      expect(report.overall).toBeCloseTo(47 / 50, 9)
      expect(report.pass).toBe(false)
      const row = report.arms[0]!.sessions.find(session => session.taskId === 'audit-clone-1')!
      expect(row.classMatches).toBe(2) // C4, C5 still match
      expect(row.logFound).toBe(true)
      expect(row.recorded).toEqual({ C1: 0, C2: 1, C3: 0, C4: 0, C5: 0 })
      expect(row.reclassified).toEqual({ C1: 1, C2: 0, C3: 1, C4: 0, C5: 0 })
      expect(report.perClass.C1).toEqual({ cells: 10, matched: 9 })
      expect(report.perClass.C2).toEqual({ cells: 10, matched: 9 })
      expect(report.perClass.C3).toEqual({ cells: 10, matched: 9 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a single mismatched cell still passes the 0.95 target (0.98)', () => {
    const { root, cloneDir, additiveDir } = buildFixture()
    try {
      const countsPath = join(cloneDir, 'counts-clone.json')
      const artifact = JSON.parse(readFileSync(countsPath, 'utf8')) as CountsArtifact
      const tampered = artifact.sessions.find(row => row.taskId === 'audit-clone-1')!
      tampered.counts = { ...tampered.counts, C1: 0 } // truth is C1:1
      writeFileSync(countsPath, JSON.stringify(artifact))

      const report = buildAuditReport(cloneDir, additiveDir)
      expect(report.overall).toBeCloseTo(49 / 50, 9)
      expect(report.pass).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// TEST 3 — missing session log
// ---------------------------------------------------------------------------

describe('bench-audit missing session log', () => {
  it('a missing log reports logFound false, classMatches 0, and 5 mismatched cells', () => {
    const { root, cloneDir, additiveDir } = buildFixture()
    try {
      rmSync(join(cloneDir, 'session-logs', 'clone', 'audit-clone-3.jsonl'))
      const cloneArm = auditArm(join(cloneDir, 'session-logs', 'clone'), cloneDir, 'clone', DEFAULT_CONFIG)
      const missing = cloneArm.sessions.find(row => row.taskId === 'audit-clone-3')!
      expect(missing.logFound).toBe(false)
      expect(missing.classMatches).toBe(0)
      expect(missing.reclassified).toEqual({ C1: 0, C2: 0, C3: 0, C4: 0, C5: 0 })
      expect(cloneArm.missingLogs).toEqual(['audit-clone-3'])
      expect(cloneArm.agreement).toBeCloseTo(20 / 25, 9) // 5 cells of 25 mismatched

      const report = buildAuditReport(cloneDir, additiveDir)
      expect(report.overall).toBeCloseTo(45 / 50, 9)
      expect(report.pass).toBe(false)
      expect(report.perClass.C1).toEqual({ cells: 10, matched: 9 }) // missing log mismatches every class
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// rendering — markdown + JSON
// ---------------------------------------------------------------------------

describe('bench-audit rendering', () => {
  it('renderAuditMarkdown: title, per-arm tables, overall PASS/FAIL vs 0.95, per-class breakdown', () => {
    const { root, cloneDir, additiveDir } = buildFixture()
    try {
      const clean = buildAuditReport(cloneDir, additiveDir)
      const cleanMd = renderAuditMarkdown(clean)
      expect(cleanMd).toContain('# Classifier Audit (second-pass agreement)')
      expect(cleanMd).toContain(`Generated at: ${clean.generatedAt}`)
      expect(cleanMd).toContain('## clone arm')
      expect(cleanMd).toContain('## additive arm')
      expect(cleanMd).toContain('| taskId | C1 recorded |')
      expect(cleanMd).toContain('5/5 found')
      expect(cleanMd).toContain('## Overall')
      expect(cleanMd).toContain('Overall agreement: 50/50 cells = 100.0% vs target 95.0% -> PASS')
      expect(cleanMd).toContain('### Per-class breakdown')
      expect(cleanMd).toContain('| C1 | 10 | 10 | 100.0% |')

      // Tamper -> FAIL rendering with a missing-log flag.
      const countsPath = join(cloneDir, 'counts-clone.json')
      const artifact = JSON.parse(readFileSync(countsPath, 'utf8')) as CountsArtifact
      artifact.sessions.find(row => row.taskId === 'audit-clone-1')!.counts = { C1: 0, C2: 1, C3: 0, C4: 0, C5: 0 }
      writeFileSync(countsPath, JSON.stringify(artifact))
      rmSync(join(cloneDir, 'session-logs', 'clone', 'audit-clone-3.jsonl'))
      const failing = buildAuditReport(cloneDir, additiveDir)
      const failingMd = renderAuditMarkdown(failing)
      expect(failingMd).toContain('-> FAIL')
      expect(failingMd).toContain('MISSING LOG')
      expect(failingMd).toContain('Missing session logs: audit-clone-3.')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('renderAuditJson round-trips the report', () => {
    const { root, cloneDir, additiveDir } = buildFixture()
    try {
      const report = buildAuditReport(cloneDir, additiveDir)
      const parsed = JSON.parse(renderAuditJson(report)) as AuditReport
      expect(parsed.overall).toBe(report.overall)
      expect(parsed.pass).toBe(report.pass)
      expect(parsed.target).toBe(0.95)
      expect(parsed.arms).toHaveLength(2)
      expect(parsed.arms[0]!.sessions).toHaveLength(5)
      expect(parsed.generatedAt).toBe(report.generatedAt)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// CLI — parseCli + main end-to-end
// ---------------------------------------------------------------------------

describe('bench-audit parseCli', () => {
  it('parses all flags with the default out path', () => {
    const options = parseAuditCli(['--clone-dir', 'a', '--additive-dir', 'b', '--manifest', 'm.json'])
    expect(options.cloneDir).toBe('a')
    expect(options.additiveDir).toBe('b')
    expect(options.manifest).toBe('m.json')
    expect(options.out).toBe('classifier-audit.md')
  })

  it('rejects unknown flags and missing required dirs', () => {
    expect(() => parseAuditCli(['--bogus'])).toThrow(/unknown flag/)
    expect(() => parseAuditCli(['--additive-dir', 'b'])).toThrow(/--clone-dir is required/)
    expect(() => parseAuditCli(['--clone-dir', 'a'])).toThrow(/--additive-dir is required/)
  })
})

describe('bench-audit CLI end-to-end', () => {
  it('writes classifier-audit.md + classifier-audit.json and exits 0 with pass true', () => {
    const { root, cloneDir, additiveDir } = buildFixture()
    const outRoot = mkdtempSync(join(tmpdir(), 'bench-audit-out-'))
    const out = join(outRoot, 'classifier-audit.md')
    try {
      const cli = fileURLToPath(new URL('../src/audit/cli.ts', import.meta.url))
      const stdout = execFileSync(process.execPath, [
        '--import', 'tsx/esm', cli,
        '--clone-dir', cloneDir,
        '--additive-dir', additiveDir,
        '--out', out,
      ], { encoding: 'utf8', cwd: process.cwd() })
      const summary = JSON.parse(stdout) as {
        overall: number
        pass: boolean
        arms: Array<{ arm: string; agreement: number }>
        markdownPath: string
        jsonPath: string
      }
      expect(summary.overall).toBe(1)
      expect(summary.pass).toBe(true)
      expect(summary.arms).toEqual([
        { arm: 'clone', agreement: 1 },
        { arm: 'additive', agreement: 1 },
      ])
      expect(summary.markdownPath).toBe(out)
      expect(summary.jsonPath).toBe(join(outRoot, 'classifier-audit.json'))
      const markdown = readFileSync(out, 'utf8')
      expect(markdown).toContain('Overall agreement:')
      expect(markdown).toContain('-> PASS')
      const json = JSON.parse(readFileSync(join(outRoot, 'classifier-audit.json'), 'utf8')) as AuditReport
      expect(json.pass).toBe(true)
      expect(json.overall).toBe(1)
      expect(json.arms).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outRoot, { recursive: true, force: true })
    }
  })

  it('main rejects with "not found" for a nonexistent clone dir', async () => {
    await expect(auditCli(['--clone-dir', '/nonexistent/bench-clone', '--additive-dir', '/nonexistent/bench-additive']))
      .rejects.toThrow(/clone dir not found/)
  })

  it('main rejects with "not found" for a nonexistent additive dir', async () => {
    const { root, cloneDir } = buildFixture()
    try {
      await expect(auditCli(['--clone-dir', cloneDir, '--additive-dir', join(root, 'ghost')]))
        .rejects.toThrow(/additive dir not found/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

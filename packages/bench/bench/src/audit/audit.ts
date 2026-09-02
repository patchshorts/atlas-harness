/**
 * `bench-audit` builder — apply the deterministic C1..C5 classifier a SECOND
 * time to exported session logs and report agreement against the counts
 * recorded at run time (first pass). The spec §6.4 target is >= 0.95.
 *
 * Inputs (written by `bench-run`, T5):
 * - `<cloneDir>/counts-clone.json` + `<cloneDir>/session-logs/clone/<taskId>.jsonl`
 * - `<additiveDir>/counts-additive.json` + `<additiveDir>/session-logs/additive/<taskId>.jsonl`
 * - optionally the frozen bench-manifest.json (spec §2.2) so the second pass
 *   uses the exact frozen lexicon row.
 *
 * Task ids may CONTAIN '/' (terminal-bench tasks, e.g.
 * `terminal-bench/bun-sourcemap-leak`), so the session-log path nests:
 * `session-logs/<arm>/terminal-bench/bun-sourcemap-leak.jsonl`. The audit is
 * fully deterministic: the same artifacts produce the same report — the only
 * clock in the output is `generatedAt`.
 *
 * @module @atlasai/atsh-bench/audit/audit
 */

import { join } from 'node:path'
import { classifySession } from '../classify/classify.ts'
import { DEFAULT_CONFIG, loadConfigFromManifest } from '../classify/config.ts'
import type { ClassifierConfig, CorrectionClass } from '../classify/types.ts'
import { loadCountsFile } from '../report/report.ts'
import { readSessionLogFile } from '../run/export.ts'
import type { AuditArmResult, AuditPerClassCell, AuditReport, AuditSessionRow } from './types.ts'

/** The five correction classes, in fixed C1..C5 order. */
const CLASSES: readonly CorrectionClass[] = ['C1', 'C2', 'C3', 'C4', 'C5']

/** Zero counts — the reclassified value for a missing session log. */
const ZERO_COUNTS = { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0 }

/**
 * Audit one arm: re-classify every session log under `logsDir` whose task id
 * appears in the `counts-<arm>.json` artifact at `countsDir`.
 *
 * Each session contributes exactly 5 classification cells (C1..C5). A
 * missing log is the honest conservative reading: `logFound: false`,
 * `classMatches: 0`, and the 5 cells count as mismatches — missing logs can
 * never inflate agreement.
 *
 * @param logsDir - directory holding `<taskId>.jsonl` session logs (paths nest for task ids containing '/').
 * @param countsDir - directory holding `counts-<arm>.json` (the first-pass artifact).
 * @param arm - which arm to audit.
 * @param config - the classifier config (frozen manifest lexicon when available).
 * @returns per-session rows and cell-level agreement for the arm.
 */
export function auditArm(logsDir: string, countsDir: string, arm: 'clone' | 'additive', config: ClassifierConfig): AuditArmResult {
  const artifact = loadCountsFile(countsDir, arm)
  const sessions: AuditSessionRow[] = []
  const missingLogs: string[] = []
  let classCells = 0
  let matchedCells = 0
  let fullyAgree = 0
  for (const recorded of artifact.sessions) {
    const log = readSessionLogFile(join(logsDir, `${recorded.taskId}.jsonl`))
    classCells += 5
    if (log === null) {
      missingLogs.push(recorded.taskId)
      sessions.push({
        taskId: recorded.taskId,
        ...(recorded.sessionId !== undefined ? { sessionId: recorded.sessionId } : {}),
        recorded: recorded.counts,
        reclassified: { ...ZERO_COUNTS },
        classMatches: 0,
        logFound: false,
      })
      continue
    }
    const reclassified = classifySession(log.events, config).counts
    let classMatches = 0
    for (const klass of CLASSES) {
      if (recorded.counts[klass] === reclassified[klass]) classMatches += 1
    }
    matchedCells += classMatches
    if (classMatches === 5) fullyAgree += 1
    sessions.push({
      taskId: recorded.taskId,
      ...(recorded.sessionId !== undefined ? { sessionId: recorded.sessionId } : {}),
      recorded: recorded.counts,
      reclassified,
      classMatches,
      logFound: true,
    })
  }
  return {
    arm,
    sessions,
    missingLogs,
    classCells,
    matchedCells,
    agreement: classCells > 0 ? matchedCells / classCells : 0,
    sessionsAgree: sessions.length > 0 ? fullyAgree / sessions.length : 0,
  }
}

/**
 * Build the full classifier audit report from two arm directories.
 *
 * Session logs live at `<dir>/session-logs/<arm>/<taskId>.jsonl`; the counts
 * artifacts live at the directory roots (`counts-clone.json` /
 * `counts-additive.json`). The overall agreement is the cell-weighted
 * agreement across both arms; `pass` is true when `overall >= 0.95`.
 *
 * @param cloneDir - directory holding the clone arm's counts artifact and `session-logs/clone/`.
 * @param additiveDir - directory holding the additive arm's counts artifact and `session-logs/additive/`.
 * @param manifestPath - optional bench-manifest.json; supplies the frozen C3/C5 lexicon (spec §2.2).
 * @returns the audit report.
 */
export function buildAuditReport(cloneDir: string, additiveDir: string, manifestPath?: string): AuditReport {
  const config = manifestPath !== undefined ? loadConfigFromManifest(manifestPath) : DEFAULT_CONFIG
  const cloneArm = auditArm(join(cloneDir, 'session-logs', 'clone'), cloneDir, 'clone', config)
  const additiveArm = auditArm(join(additiveDir, 'session-logs', 'additive'), additiveDir, 'additive', config)
  const arms: AuditArmResult[] = [cloneArm, additiveArm]

  const classCells = arms.reduce((sum, arm) => sum + arm.classCells, 0)
  const matchedCells = arms.reduce((sum, arm) => sum + arm.matchedCells, 0)
  const overall = classCells > 0 ? matchedCells / classCells : 0

  const perClass: Record<'C1' | 'C2' | 'C3' | 'C4' | 'C5', AuditPerClassCell> = {
    C1: { cells: 0, matched: 0 },
    C2: { cells: 0, matched: 0 },
    C3: { cells: 0, matched: 0 },
    C4: { cells: 0, matched: 0 },
    C5: { cells: 0, matched: 0 },
  }
  for (const arm of arms) {
    for (const row of arm.sessions) {
      for (const klass of CLASSES) {
        perClass[klass].cells += 1
        // A missing log is a mismatch in every class (conservative reading).
        if (row.logFound && row.recorded[klass] === row.reclassified[klass]) perClass[klass].matched += 1
      }
    }
  }

  const target = 0.95
  return {
    arms,
    overall,
    perClass,
    target,
    pass: overall >= target,
    generatedAt: new Date().toISOString(),
  }
}

/** Render one per-session audit row as a markdown table line. */
function auditRowLine(row: AuditSessionRow): string {
  return [
    `| ${row.taskId}`,
    ` ${row.recorded.C1}`,
    ` ${row.recorded.C2}`,
    ` ${row.recorded.C3}`,
    ` ${row.recorded.C4}`,
    ` ${row.recorded.C5}`,
    ` ${row.reclassified.C1}`,
    ` ${row.reclassified.C2}`,
    ` ${row.reclassified.C3}`,
    ` ${row.reclassified.C4}`,
    ` ${row.reclassified.C5}`,
    ` ${row.classMatches}/5`,
    ` ${row.logFound ? 'found' : 'MISSING LOG'} |`,
  ].join('')
}

/** Format a fraction as a percentage string. */
function fmtPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

/**
 * Render the audit report as markdown (classifier-audit.md): a title,
 * generation timestamp, per-arm tables (recorded vs reclassified counts per
 * class, match n/5, missing-log flag), per-arm agreement lines, the overall
 * agreement with PASS/FAIL against the 0.95 target, and a per-class
 * breakdown table.
 *
 * @param report - the audit report to render.
 * @returns the markdown text (deterministic for the same report).
 */
export function renderAuditMarkdown(report: AuditReport): string {
  const lines: string[] = []
  lines.push('# Classifier Audit (second-pass agreement)', '')
  lines.push(`Generated at: ${report.generatedAt}`, '')
  lines.push('')
  lines.push('The deterministic C1..C5 classifier is applied a SECOND time to the exported session logs, and the resulting counts are compared against the counts recorded at run time (first pass). Agreement = matched classification cells / total classification cells (5 per session). A missing session log counts as 5 mismatched cells.', '')
  for (const arm of report.arms) {
    lines.push('', `## ${arm.arm} arm`, '')
    lines.push('| taskId | C1 recorded | C2 recorded | C3 recorded | C4 recorded | C5 recorded | C1 reclassified | C2 reclassified | C3 reclassified | C4 reclassified | C5 reclassified | match | log |')
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for (const row of arm.sessions) lines.push(auditRowLine(row))
    lines.push('')
    lines.push(`${arm.arm} arm agreement: ${arm.matchedCells}/${arm.classCells} cells = ${fmtPct(arm.agreement)} (sessions fully agreeing: ${Math.round(arm.sessionsAgree * arm.sessions.length)}/${arm.sessions.length}).`)
    if (arm.missingLogs.length > 0) {
      lines.push(`Missing session logs: ${arm.missingLogs.join(', ')}.`)
    }
  }
  const totalCells = report.arms.reduce((sum, arm) => sum + arm.classCells, 0)
  const totalMatched = report.arms.reduce((sum, arm) => sum + arm.matchedCells, 0)
  lines.push('', '## Overall', '')
  lines.push(`Overall agreement: ${totalMatched}/${totalCells} cells = ${fmtPct(report.overall)} vs target ${fmtPct(report.target)} -> ${report.pass ? 'PASS' : 'FAIL'}.`, '')
  lines.push('### Per-class breakdown', '')
  lines.push('| class | cells | matched | agreement |')
  lines.push('|---|---|---|---|')
  for (const klass of CLASSES) {
    const cell = report.perClass[klass]
    lines.push(`| ${klass} | ${cell.cells} | ${cell.matched} | ${fmtPct(cell.cells > 0 ? cell.matched / cell.cells : 0)} |`)
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * Serialize the audit report as the sidecar classifier-audit.json.
 * @param report - the audit report to serialize.
 * @returns the JSON text (deterministic for the same report).
 */
export function renderAuditJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2)
}

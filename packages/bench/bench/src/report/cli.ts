/**
 * `bench-report` CLI — build the paired comparison report from two arm
 * directories and write bench-results.md + bench-results.json.
 *
 * Usage (from the bench package or repo root):
 *
 * ```
 * node --import tsx/esm packages/bench/bench/src/report/cli.ts \
 *   --clone-dir bench-runs/run-1 \
 *   --additive-dir bench-runs/run-1 \
 *   --manifest bench-runs/run-1/run.log \
 *   --out bench-runs/run-1/bench-results.md \
 *   --audit-agreement 0.96 \
 *   --iteration 1
 * ```
 *
 * Flags:
 * - `--clone-dir` (required): directory holding counts-clone.json + cost-clone.json
 * - `--additive-dir` (required): directory holding counts-additive.json + cost-additive.json
 * - `--manifest`: path to the shared run.log (or its directory) for the
 *   header (fingerprint + model pin + manifest hash); optional
 * - `--out`: path to bench-results.md; the JSON sidecar is written alongside
 *   as bench-results.json (default `bench-results.md`)
 * - `--audit-agreement`: classifier audit agreement 0..1 (spec §6.4);
 *   omitted = criterion 4 PENDING
 * - `--iteration`: iteration number for the header (default 1)
 *
 * @module @atlasai/atsh-bench/report/cli
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildReport } from './report.ts'
import { renderJson, renderMarkdown } from './markdown.ts'

/** Parsed CLI options. */
export interface ReportCliOptions {
  cloneDir: string
  additiveDir: string
  manifest: string | undefined
  out: string
  auditAgreement: number | undefined
  iteration: number
}

/** Parse argv into report CLI options (mirrors run/cli.ts flag style). */
export function parseCli(argv: readonly string[]): ReportCliOptions {
  const options: ReportCliOptions = {
    cloneDir: process.cwd(),
    additiveDir: process.cwd(),
    manifest: undefined,
    out: 'bench-results.md',
    auditAgreement: undefined,
    iteration: 1,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = (): string => {
      index += 1
      return argv[index] ?? ''
    }
    switch (arg) {
      case '--clone-dir': options.cloneDir = next(); break
      case '--additive-dir': options.additiveDir = next(); break
      case '--manifest': options.manifest = next(); break
      case '--out': options.out = next(); break
      case '--audit-agreement': options.auditAgreement = Number(next()); break
      case '--iteration': options.iteration = Number(next()); break
      default: throw new Error(`bench-report: unknown flag ${JSON.stringify(arg)}`)
    }
  }
  if (options.auditAgreement !== undefined && !(options.auditAgreement >= 0 && options.auditAgreement <= 1)) {
    throw new Error(`bench-report: --audit-agreement must be in [0, 1], got ${options.auditAgreement}`)
  }
  if (!Number.isInteger(options.iteration) || options.iteration < 1) {
    throw new Error(`bench-report: --iteration must be a positive integer, got ${options.iteration}`)
  }
  return options
}

/** The main report CLI entry point. */
export function main(argv: readonly string[]): Promise<number> {
  return Promise.resolve().then(() => {
    const options = parseCli(argv)
    if (!existsSync(options.cloneDir)) {
      throw new Error(`bench-report: clone dir not found: ${options.cloneDir}`)
    }
    if (!existsSync(options.additiveDir)) {
      throw new Error(`bench-report: additive dir not found: ${options.additiveDir}`)
    }
    const report = buildReport({
      cloneDir: options.cloneDir,
      additiveDir: options.additiveDir,
      ...(options.manifest !== undefined ? { manifest: options.manifest } : {}),
      ...(options.auditAgreement !== undefined ? { auditAgreement: options.auditAgreement } : {}),
      iteration: options.iteration,
    })
    const markdownPath = resolve(options.out)
    const jsonPath = markdownPath.endsWith('.md')
      ? `${markdownPath.slice(0, -3)}.json`
      : `${markdownPath}.json`
    mkdirSync(dirname(markdownPath), { recursive: true })
    writeFileSync(markdownPath, renderMarkdown(report))
    writeFileSync(jsonPath, renderJson(report))
    console.log(JSON.stringify({
      iteration: report.iteration,
      overall: report.overall,
      criteria: report.criteria.map(criterion => ({ criterion: criterion.criterion, status: criterion.status })),
      markdownPath,
      jsonPath,
    }, null, 2))
    return 0
  })
}

// Direct-execution entry: node --import tsx/esm src/report/cli.ts --clone-dir ...
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.ts')) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (error: unknown) => {
      console.error(String(error))
      process.exitCode = 1
    },
  )
}

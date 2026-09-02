/**
 * `bench-audit` CLI — apply the deterministic C1..C5 classifier a SECOND
 * time to exported session logs and write classifier-audit.md +
 * classifier-audit.json with the agreement against the first-pass counts.
 *
 * Usage (from the bench package or repo root):
 *
 * ```
 * node --import tsx/esm packages/bench/bench/src/audit/cli.ts \
 *   --clone-dir bench-runs/run-1 \
 *   --additive-dir bench-runs/run-1 \
 *   --manifest bench-manifest.json \
 *   --out bench-runs/run-1/classifier-audit.md
 * ```
 *
 * Flags:
 * - `--clone-dir` (required): directory holding counts-clone.json +
 *   session-logs/clone/ (one `<taskId>.jsonl` per session)
 * - `--additive-dir` (required): directory holding counts-additive.json +
 *   session-logs/additive/
 * - `--manifest`: path to bench-manifest.json for the frozen C3/C5 lexicon
 *   (spec §2.2); optional — defaults mirror the frozen row
 * - `--out`: path to classifier-audit.md; the JSON sidecar is written
 *   alongside as classifier-audit.json (default `classifier-audit.md`)
 *
 * @module @atlasai/atsh-bench/audit/cli
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildAuditReport, renderAuditJson, renderAuditMarkdown } from './audit.ts'

/** Parsed CLI options. */
export interface AuditCliOptions {
  cloneDir: string
  additiveDir: string
  manifest: string | undefined
  out: string
}

/** Parse argv into audit CLI options (mirrors report/cli.ts flag style). */
export function parseCli(argv: readonly string[]): AuditCliOptions {
  const options: AuditCliOptions = {
    cloneDir: '',
    additiveDir: '',
    manifest: undefined,
    out: 'classifier-audit.md',
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
      default: throw new Error(`bench-audit: unknown flag ${JSON.stringify(arg)}`)
    }
  }
  if (options.cloneDir === '') throw new Error('bench-audit: --clone-dir is required')
  if (options.additiveDir === '') throw new Error('bench-audit: --additive-dir is required')
  return options
}

/** The main audit CLI entry point. */
export function main(argv: readonly string[]): Promise<number> {
  return Promise.resolve().then(() => {
    const options = parseCli(argv)
    if (!existsSync(options.cloneDir)) {
      throw new Error(`bench-audit: clone dir not found: ${options.cloneDir}`)
    }
    if (!existsSync(options.additiveDir)) {
      throw new Error(`bench-audit: additive dir not found: ${options.additiveDir}`)
    }
    const report = buildAuditReport(options.cloneDir, options.additiveDir, options.manifest)
    const markdownPath = resolve(options.out)
    const jsonPath = markdownPath.endsWith('.md')
      ? `${markdownPath.slice(0, -3)}.json`
      : `${markdownPath}.json`
    mkdirSync(dirname(markdownPath), { recursive: true })
    writeFileSync(markdownPath, renderAuditMarkdown(report))
    writeFileSync(jsonPath, renderAuditJson(report))
    console.log(JSON.stringify({
      overall: report.overall,
      pass: report.pass,
      arms: report.arms.map(arm => ({ arm: arm.arm, agreement: arm.agreement })),
      markdownPath,
      jsonPath,
    }, null, 2))
    return 0
  })
}

// Direct-execution entry: node --import tsx/esm src/audit/cli.ts --clone-dir ...
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.ts')) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (error: unknown) => {
      console.error(String(error))
      process.exitCode = 1
    },
  )
}

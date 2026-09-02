/**
 * `bench-run` CLI — drive one arm of the benchmark from the command line.
 *
 * Usage (from the bench package or repo root):
 *
 * ```
 * DEEPSEEK_API_KEY=... node --import tsx/esm \
 *   packages/bench/bench/src/run/cli.ts \
 *   --arm clone --task mem-5-dependency-matrix \
 *   --harness /tmp/bench-clone \
 *   --manifest bench-manifest.json \
 *   --output bench-runs/run-1 \
 *   --model deepseek-v4-flash --max-tokens 8192
 * ```
 *
 * Flags:
 * - `--arm` (required): `clone` | `additive`
 * - `--task` (repeatable): task ids to run; default = all manifest tasks
 * - `--harness`: harness repo root (clone worktree for clone arm, additive repo for additive)
 * - `--manifest`: path to bench-manifest.json (default: repo-root bench-manifest.json)
 * - `--output`: run output root (default: `bench-runs/<run-id>`)
 * - `--model`, `--max-tokens`, `--temperature` (default 0)
 * - `--timeout-ms` (default 1800000 = 30 min)
 * - `--dry-run`: skip spawning the harness (unit-test mode)
 *
 * Writes per-session JSONL logs to `<output>/session-logs/<arm>/`, a
 * per-arm `counts-<arm>.json` summary, a `cost-<arm>.json` sidecar, and a
 * `run.log` carrying the fingerprint + model pin.
 *
 * @module @atlasai/atsh-bench/run/cli
 */

import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { aggregateArm, fingerprint, newRunId, runOutputRoot, runSession, writeRunLog } from './run.ts'
import { loadConfigFromManifest } from '../classify/config.ts'
import { sha256Hex } from '../classify/events.ts'
import { isLumeGrade, LUME_GRADES } from './reducer-ladder.ts'
import type { BenchArm, RunFingerprint } from './run.ts'

/** Parsed CLI options. */
interface CliOptions {
  arm: BenchArm
  tasks: string[]
  harness: string
  manifest: string
  output: string
  model: string
  maxTokens: number
  temperature: number
  timeoutMs: number
  dryRun: boolean
  /** prompt-lume reducer grade: low|med|high|xhigh|off (broaden-design §4.4). */
  promptLumeGrade: 'low' | 'med' | 'high' | 'xhigh' | 'off' | undefined
}

/** Parse argv into CLI options. */
export function parseCli(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    arm: 'clone',
    tasks: [],
    harness: process.cwd(),
    manifest: 'bench-manifest.json',
    output: '',
    model: 'deepseek-v4-flash',
    maxTokens: 8192,
    temperature: 0,
    timeoutMs: 30 * 60 * 1000,
    dryRun: false,
    promptLumeGrade: undefined,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = (): string => {
      index += 1
      return argv[index] ?? ''
    }
    switch (arg) {
      case '--arm': options.arm = next() as BenchArm; break
      case '--task': options.tasks.push(next()); break
      case '--harness': options.harness = next(); break
      case '--manifest': options.manifest = next(); break
      case '--output': options.output = next(); break
      case '--model': options.model = next(); break
      case '--max-tokens': options.maxTokens = Number(next()); break
      case '--temperature': options.temperature = Number(next()); break
      case '--timeout-ms': options.timeoutMs = Number(next()); break
      case '--lume-grade': {
        const grade = next()
        if (!isLumeGrade(grade)) {
          throw new Error(`bench-run: --lume-grade must be one of ${LUME_GRADES.join('|')}, got ${JSON.stringify(grade)}`)
        }
        options.promptLumeGrade = grade
        break
      }
      case '--dry-run': options.dryRun = true; break
      default: throw new Error(`bench-run: unknown flag ${JSON.stringify(arg)}`)
    }
  }
  const validArms = new Set<string>(['clone', 'additive'])
  if (!validArms.has(options.arm)) {
    throw new Error(`bench-run: --arm must be 'clone' or 'additive', got ${JSON.stringify(options.arm)}`)
  }
  if (options.output === '') options.output = runOutputRoot(process.cwd(), newRunId())
  return options
}

/** Resolve the task list from the manifest. */
export function tasksFromManifest(manifestPath: string, filter: string[]): string[] {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    custom?: { tasks?: Array<{ id: string; prompt: string; micro_repo: string; verifier: string }> }
    tbench?: { tasks?: Array<{ id: string; instruction: string; path?: string }> }
    reserve?: { tasks?: Array<{ id: string; prompt: string; micro_repo: string; verifier: string }> }
  }
  const core: string[] = []
  for (const task of manifest.custom?.tasks ?? []) core.push(task.id)
  for (const task of manifest.tbench?.tasks ?? []) core.push(task.id)
  // Reserve pool (pre-registered for the n=64 escalation, spec §5): addressable
  // only by explicit --task filter; never included in the default core run.
  const reserve: string[] = []
  for (const task of manifest.reserve?.tasks ?? []) reserve.push(task.id)
  const all = [...core, ...reserve]
  if (filter.length === 0) return core
  const missing = filter.filter(id => !all.includes(id))
  if (missing.length > 0) {
    throw new Error(`bench-run: unknown task ids: ${missing.join(', ')} (manifest has ${all.length})`)
  }
  return filter
}

/** Read a task's runner descriptor from the manifest. */
export function taskDescriptor(manifestPath: string, taskId: string): {
  prompt: string
  sandboxSeedDir?: string
  verifier?: string
} {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    custom?: {
      base_dir?: string
      tasks?: Array<{
        id: string
        prompt: string
        micro_repo: string
        verifier: string
      }>
    }
    tbench?: { tasks?: Array<{ id: string; instruction: string; path?: string }> }
    reserve?: { tasks?: Array<{
      id: string
      prompt: string
      micro_repo: string
      verifier: string
    }> }
  }
  const task = manifest.custom?.tasks?.find(t => t.id === taskId)
    ?? manifest.reserve?.tasks?.find(t => t.id === taskId)
  if (task) {
    // Manifest task entries carry repo-root-relative paths (prompt,
    // micro_repo, verifier); resolve them against the repo root directly.
    // base_dir is a documentation fallback — never joined again (the
    // pre-fix double join produced .../tasks/custom/tasks/custom/... paths).
    const promptPath = resolve(process.cwd(), task.prompt)
    return {
      prompt: readFileSync(promptPath, 'utf8'),
      sandboxSeedDir: resolve(process.cwd(), task.micro_repo),
      verifier: resolve(process.cwd(), task.verifier),
    }
  }
  // tbench tasks: materialize the pinned upstream checkout's task workspace —
  // instruction.md as the prompt, environment/ as the sandbox seed, and the
  // shared local verifier (pytest over the task's tests/). The checkout is
  // the harbor-framework/terminal-bench commit pinned in bench-manifest.json,
  // located via TBENCH_CHECKOUT (default /tmp/tbench-probe; the pinned
  // checkout from T3). Container-state tests may under-report locally; the
  // limitation is recorded in the run log, not silently.
  const tbenchEntry = manifest.tbench?.tasks?.find(t => t.id === taskId)
  if (tbenchEntry) {
    const checkout = process.env.TBENCH_CHECKOUT ?? '/tmp/tbench-probe'
    const taskDir = join(checkout, 'tasks', (tbenchEntry.path ?? '').replace(/^tasks\//, ''))
    const instructionPath = join(taskDir, 'instruction.md')
    const environmentDir = join(taskDir, 'environment')
    return {
      prompt: existsSync(instructionPath) ? readFileSync(instructionPath, 'utf8') : `Complete the task ${taskId}`,
      ...(existsSync(environmentDir) ? { sandboxSeedDir: environmentDir } : {}),
      verifier: resolve(process.cwd(), 'packages/bench/bench/tasks/tbench-verify.sh'),
    }
  }
  // Unmapped task: no workspace to materialize.
  return { prompt: `Complete the task ${taskId}` }
}

/**
 * Stable identity hash for the bench manifest: sha256 of the file with its
 * own `manifest_sha256` field blanked. The field is self-referential, so a
 * raw-file hash can never equal the recorded pin; blanking makes the pin
 * recomputable and stable under its own update (T3's original pin matched
 * neither the raw nor a canonicalized hash — recomputability failed).
 */
export function manifestIdentityHash(manifestText: string): string {
  try {
    const parsed = JSON.parse(manifestText) as Record<string, unknown>
    parsed.manifest_sha256 = ''
    return sha256Hex(JSON.stringify(parsed, null, 2))
  } catch {
    return sha256Hex(manifestText)
  }
}

/** The main CLI entry point. */
export async function main(argv: readonly string[]): Promise<number> {
  const options = parseCli(argv)
  if (!existsSync(options.manifest)) {
    throw new Error(`bench-run: manifest not found: ${options.manifest}`)
  }
  const tasks = tasksFromManifest(options.manifest, options.tasks)
  const classifyConfig = loadConfigFromManifest(options.manifest)
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8')) as {
    prices?: { uncached_input_per_mtok?: unknown; cached_input_per_mtok?: unknown; output_per_mtok?: unknown }
  }
  // Coerce + validate: a placeholder string (e.g. "pinned at run start")
  // would flow into the USD math as NaN and serialize as null — the T3
  // manifest shipped exactly that for output_per_mtok. Non-numeric prices
  // fall back to the spec defaults rather than poisoning the sidecar.
  const num = (value: unknown, fallback: number): number => {
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
  }
  const prices = {
    uncachedInputPerMTok: num(manifest.prices?.uncached_input_per_mtok, 0.435),
    cachedInputPerMTok: num(manifest.prices?.cached_input_per_mtok, 0.0033),
    outputPerMTok: num(manifest.prices?.output_per_mtok, 0.435),
  }
  const fp: RunFingerprint = await fingerprint(options.harness)
  const pin = { model: options.model, temperature: options.temperature, maxTokens: options.maxTokens }
  const manifestSha = manifestIdentityHash(readFileSync(options.manifest, 'utf8'))

  // Preflight disk-space check. A run that cannot write its own evidence must fail FAST
  // with a clear message, not die silently mid-arm. 2 GiB headroom keeps the
  // session-log exports + counts + cost sidecar safe on a busy host.
  mkdirSync(options.output, { recursive: true })
  const freeBytes = statfsSync(options.output).bavail * statfsSync(options.output).bsize
  const FREE_MIN_BYTES = 2 * 1024 ** 3
  if (freeBytes < FREE_MIN_BYTES) {
    throw new Error(
      `bench-run: output filesystem ${options.output} has only ${(freeBytes / 1024 ** 3).toFixed(2)} GiB free ` +
      '(need >= 2 GiB). Free space and relaunch — a disk-full arm dies silently.',
    )
  }

  writeRunLog(options.output, fp, pin, undefined, manifestSha)

  const runStartMs = Date.now()
  const outcomes = []
  const errors: Array<{ taskId: string; error: string }> = []
  for (const taskId of tasks) {
    let outcome
    try {
      const descriptor = taskDescriptor(options.manifest, taskId)
      outcome = await runSession({
        arm: options.arm,
        taskId,
        prompt: descriptor.prompt,
        ...(descriptor.sandboxSeedDir !== undefined ? { sandboxSeedDir: descriptor.sandboxSeedDir } : {}),
        ...(descriptor.verifier !== undefined ? { verifier: descriptor.verifier } : {}),
        harnessRepo: options.harness,
        profile: 'headless',
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        sessionTimeoutMs: options.timeoutMs,
        outputRoot: options.output,
        prices,
        classifyConfig,
        ...(options.promptLumeGrade !== undefined ? { promptLumeGrade: options.promptLumeGrade } : {}),
        dryRun: options.dryRun,
      })
    } catch (error) {
      // Per-session fault isolation: one throwing session must never kill the
      // whole arm silently. Record the error in the run log and continue.
      const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
      errors.push({ taskId, error: message })
      // The error-write path is fault-isolated too. A
      // logging failure must never take the run down — record what we can and
      // continue.
      try {
        writeRunLog(options.output, fp, pin, {
          arm: options.arm,
          taskId,
          sessionId: undefined,
          exitCode: -1,
          timedOut: false,
          elapsedSec: 0,
          taskSuccess: null,
          total: 0,
          per100Calls: 0,
          costUsd: 0,
          cacheHitRate: 0,
          wasteRatio: 0,
          turnCount: 0,
          turns: [],
          error: message,
        }, manifestSha, 'session-error')
      } catch (logError) {
        console.error(`bench-run: FAILED to record session-error for ${taskId}: ${String(logError)}`)
      }
      console.error(`bench-run: session ${taskId} failed: ${message}`)
      continue
    }
    outcomes.push(outcome)
    writeRunLog(options.output, fp, pin, {
      arm: outcome.arm,
      taskId: outcome.taskId,
      sessionId: outcome.sessionId,
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      elapsedSec: outcome.elapsedSec,
      taskSuccess: outcome.taskSuccess,
      total: outcome.classify.total,
      per100Calls: outcome.classify.per100Calls,
      costUsd: outcome.cost.usd,
      cacheHitRate: outcome.cost.cacheHitRate,
      wasteRatio: outcome.waste.session.wasteRatio,
      turnCount: outcome.waste.turns.length,
      turns: outcome.waste.turns.map(t => ({
        turn: t.turn, totalCalls: t.totalCalls, wastedCalls: t.wastedCalls, wasteRatio: t.wasteRatio,
      })),
    }, manifestSha)
  }
  const runEndError = errors.length > 0
    ? `run-end: ${errors.length} session error(s): ${errors.map(e => e.taskId).join(', ')}`
    : undefined
  writeRunLog(options.output, fp, pin, {
    arm: options.arm,
    taskId: '__run_end__',
    sessionId: undefined,
    exitCode: errors.length > 0 ? 1 : 0,
    timedOut: false,
    elapsedSec: Math.round((Date.now() - runStartMs) / 1000),
    taskSuccess: null,
    total: outcomes.length,
    per100Calls: 0,
    costUsd: 0,
    cacheHitRate: 0,
    wasteRatio: 0,
    turnCount: 0,
    turns: [],
    ...(runEndError !== undefined ? { error: runEndError } : {}),
  }, manifestSha, 'run-end')

  const aggregated = aggregateArm(options.arm, outcomes)
  const countsPath = join(options.output, `counts-${options.arm}.json`)
  const costPath = join(options.output, `cost-${options.arm}.json`)
  writeFileSync(countsPath, `${JSON.stringify({
    arm: options.arm,
    run: new Date().toISOString(),
    sessions: outcomes.map(s => ({
      taskId: s.taskId,
      sessionId: s.sessionId,
      exitCode: s.exitCode,
      timedOut: s.timedOut,
      taskSuccess: s.taskSuccess,
      events: s.classify.events,
      toolCalls: s.classify.toolCalls,
      counts: s.classify.counts,
      total: s.classify.total,
      per100Calls: s.classify.per100Calls,
      hits: s.classify.hits,
      turns: s.waste.turns.map(t => ({
        turn: t.turn, totalCalls: t.totalCalls, wastedCalls: t.wastedCalls, wasteRatio: t.wasteRatio,
      })),
    })),
    meanCorrections: aggregated.meanCorrections,
    per100Calls: aggregated.per100Calls,
    successRate: aggregated.successRate,
  }, null, 2)}\n`)
  writeFileSync(costPath, `${JSON.stringify({
    arm: options.arm,
    prices,
    sessions: outcomes.map(s => ({ taskId: s.taskId, ...s.cost })),
    meanCostUsd: aggregated.meanCostUsd,
    meanCacheHitRate: aggregated.meanCacheHitRate,
  }, null, 2)}\n`)

  console.log(JSON.stringify({
    arm: options.arm,
    tasks: tasks.length,
    meanCorrections: aggregated.meanCorrections,
    per100Calls: aggregated.per100Calls,
    successRate: aggregated.successRate,
    meanCostUsd: aggregated.meanCostUsd,
    meanCacheHitRate: aggregated.meanCacheHitRate,
    countsPath,
    costPath,
    runLog: join(options.output, 'run.log'),
    sessionErrors: errors.map(e => ({ taskId: e.taskId })),
  }, null, 2))
  return errors.length > 0 ? 1 : 0
}

// Direct-execution entry: node --import tsx/esm src/run/cli.ts --arm ...
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.ts')) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (error: unknown) => {
      console.error(String(error))
      process.exitCode = 1
    },
  )
}

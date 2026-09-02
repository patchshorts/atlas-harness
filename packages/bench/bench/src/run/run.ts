/**
 * `bench-run` — the N-sessions-per-arm runner (benchmark spec §5, §7, §9).
 *
 * Drives one arm's session matrix through the real harness CLI
 * (`node --import tsx/esm apps/cli/src/bin.ts --profile headless "<task>"`)
 * with strict benchmark controls per session:
 *
 * - fresh `ATSH_HOME` per session (fresh session dir + fresh sandbox),
 *   home patch `$ATSH_HOME/cordis.patch.yml` forcing the pin plugin
 *   (`bench-pin-request`: model / temperature 0 / maxTokens) and the
 *   JSONL backend in plaintext mode (`compression: none`, `packChunks:
 *   false`) so `session.jsonl` is directly readable by `export.ts`;
 * - `ATSH_PERMISSION_MODE=danger-full-access` (approval never) — headless
 *   sessions have no approval channel; the benchmark's isolation is the
 *   per-session sandbox directory, not interactive permission prompts;
 * - 30-minute hard wall-clock timeout per session (spec §9);
 * - session-log export after each session (`session-logs/<arm>/<task>.jsonl`),
 *   deterministic C1..C5 classification via `bench-classify`, and the
 *   cost sidecar (spec §7) over `TokenUsage` fields on `assistant/message`
 *   and `assistant/chunk` (usage) events;
 * - run log recording the environment fingerprint (node, OS, RAM) and the
 *   model pin (spec §5: "environment fingerprint ... recorded in the run log").
 *
 * The runner is itself an ADD (packages/bench, the bench workstream) — it never modifies
 * a frozen upstream file. It spawns the harness as a child process; it does
 * not run inside the harness composition.
 *
 * @module @atlasai/atsh-bench/run/run
 */

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifySession } from '../classify/classify.ts'
import { loadConfigFromManifest } from '../classify/config.ts'
import { sha256Hex } from '../classify/events.ts'
import { computeTurnWasteRatio } from '../report/stats.ts'
import type { TurnWasteResult } from '../report/stats.ts'
import { findNewestSessionLog, parseTokenUsage, readSessionLogFile } from './export.ts'
import type { SessionLogEvent } from '../classify/types.ts'

/** One arm of the benchmark (spec §5: clone arm first, additive second). */
export type BenchArm = 'clone' | 'additive'

/** Per-session token accounting (spec §7). */
export interface SessionCost {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  uncachedInputTokens: number
  outputTokens: number
  /** cacheReadTokens / inputTokens, 0 when no input. */
  cacheHitRate: number
  /** USD per session, prices pinned at run start (spec §7). */
  usd: number
  /** assistant/message events carrying TokenUsage; missing = data-quality flag. */
  usageEvents: number
  /** assistant/message events WITHOUT TokenUsage (spec §7 data-quality flag). */
  missingUsageEvents: number
}

/** The outcome of one session (one task on one arm). */
export interface SessionOutcome {
  arm: BenchArm
  taskId: string
  /** Harness session id from the exported log header, when present. */
  sessionId: string | undefined
  /** Harness process exit code (0 = clean exit; 124/137 = killed by timeout). */
  exitCode: number
  /** True when the 30-min wall clock fired. */
  timedOut: boolean
  /** Absolute path of the exported log (session-logs/<arm>/<task>.jsonl). */
  logPath: string
  /** Deterministic classification result (bench-classify). */
  classify: ReturnType<typeof classifySession>
  /** Cost sidecar for this session (spec §7). */
  cost: SessionCost
  /** Waste-ratio primary metric (broaden-design §2, §4.5): session aggregate + per-turn. */
  waste: TurnWasteResult
  /** True when the task verifier passed (task success, spec §2.4). */
  taskSuccess: boolean | null
  /** Verifier exit code, when one ran. */
  verifierExit: number | null
  /** Seconds the harness process ran. */
  elapsedSec: number
  /** Harness stderr tail (last 2KB) for failure diagnosis. */
  stderrTail: string
}

/** Aggregate per-arm results. */
export interface ArmRunResult {
  arm: BenchArm
  sessions: SessionOutcome[]
  /** Mean corrections per session across sessions with a classification. */
  meanCorrections: number
  /** Corrections per 100 tool calls across sessions (spec §2.4). */
  per100Calls: number
  /** Task success rate (passed / attempted), null when no verifier ran. */
  successRate: number | null
  /** Mean USD per session across sessions with usage data. */
  meanCostUsd: number
  /** Mean cache hit rate across sessions with usage data. */
  meanCacheHitRate: number
}

/** Environment fingerprint recorded in the run log (spec §5, §9). */
export interface RunFingerprint {
  nodeVersion: string
  platform: string
  arch: string
  cpus: string
  totalMemGb: number
  harnessRepoHead: string
  harnessRepo: string
  dshProfile: string
}

/** One run-log entry line (JSON, one per session). */
export interface RunLogEntry {
  arm: BenchArm
  taskId: string
  sessionId: string | undefined
  exitCode: number
  timedOut: boolean
  elapsedSec: number
  taskSuccess: boolean | null
  total: number
  per100Calls: number
  costUsd: number
  cacheHitRate: number
  /** Session-level waste-ratio primary metric (broaden-design §2, 0 when no calls). */
  wasteRatio: number
  /** Number of tool-calling turns in the session (per-turn n gain, §4.5). */
  turnCount: number
  /** Per-turn waste-ratio segments (ascending turn; each run a tool call). */
  turns: Array<{ turn: number; totalCalls: number; wastedCalls: number; wasteRatio: number }>
  /** Present only on failed sessions / the run-end marker (fault isolation). */
  error?: string
}

/** Runner options for a single session. */
export interface SessionRunOptions {
  arm: BenchArm
  taskId: string
  /** The task prompt text (custom task prompt.md content, or tbench instruction). */
  prompt: string
  /**
   * Optional task working tree to copy into the fresh sandbox (custom task
   * micro-repo). When omitted, the sandbox starts empty (tbench materializes
   * its own workspace via the pinned harness).
   */
  sandboxSeedDir?: string
  /** Optional verifier script; run in the sandbox with the sandbox as $1. */
  verifier?: string
  /**
   * The harness repo to boot (`apps/cli/src/bin.ts` under it). For the clone
   * arm this is the vanilla checkout; for the additive arm the additive repo.
   */
  harnessRepo: string
  /** The atsh profile to boot (default headless). */
  profile?: string
  /** Pinned model id (spec §9). */
  model: string
  /** Sampling temperature, benchmark-pinned to 0 (spec §9). */
  temperature: number
  /** Max output tokens per request (spec §9). */
  maxTokens: number
  /** Hard wall-clock cap per session, ms (spec §9: 30 min). */
  sessionTimeoutMs: number
  /** Output root: `<root>/session-logs/<arm>/`, `<root>/run.log`. */
  outputRoot: string
  /** Pinned price sheet (spec §7): uncached/cached input + output USD per MTok. */
  prices: { uncachedInputPerMTok: number; cachedInputPerMTok: number; outputPerMTok: number }
  /** Mount the loop-guard (call ceiling + D6 alarm fold) for both per-session sets. */
  guard?: { callCeiling: number; repeatedCallThreshold?: number; minOutputFraction?: number; fallbackDirectiveText?: string }
  /** Mount the stale-knowledge verify-required bit: task prompt text. */
  verify?: { prompt: string; patterns?: readonly string[]; verificationPurpose?: string }
  /** Mount the plan-vs-actual cost tripwire: the plan's estimated tool-call count. */
  tripwire?: { planEstimatedToolCalls: number; tripRatio?: number; checkpointDirectiveText?: string }
  /** Mount the C1-style retry judge: consecutive-retry ceiling. */
  retryJudge?: { maxConsecutiveRetries?: number; pivotDirectiveText?: string }
  /** Mount the self-authoring mistake ledger: pinned-record core. */
  ledger?: { repeatDirectiveText?: string }
  /** Mount the contract pre-flight checklist: contract + tests paths. */
  preExecute?: { contractPath: string; testsPath: string; directiveText?: string }
  /** Classifier config override (lexicon from the frozen manifest). */
  classifyConfig?: Partial<ReturnType<typeof loadConfigFromManifest> extends infer T ? T : never>
  /**
   * prompt-lume reducer grade (broaden-design §4.4). The base bundle mounts
   * prompt-lume as DEFAULT-ON, so most runs need no model
   * switch. This id-targeted override lets a run sweep the reduction level
   * (low/med/high/xhigh) or disable the reducer entirely ('off' →
   * enabled:false) — the within-arm grade ladder that replaces cross-arm
   * prompt-lume-vs-vanilla comparison (provider-cache confound). Never
   * re-inserts the row; an override only mutates the mounted config.
   */
  promptLumeGrade?: 'low' | 'med' | 'high' | 'xhigh' | 'off'
  /** Extra environment for the harness process (DEEPSEEK_API_KEY etc). */
  env?: Record<string, string>
  /** Skip actually spawning the harness (used by unit tests). */
  dryRun?: boolean
}

/** Absolute path of this module's own pin plugin source (home-patch mount). */
export function pinPluginPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'pin.ts')
}

/** Absolute path of this module's own loop-guard plugin source (home-patch mount). */
export function guardPluginPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'guard.ts')
}

/** Absolute path of this module's own serve-trace plugin source (home-patch mount, the corrections pass). */
export function tracePluginPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'trace.ts')
}

/** Absolute path of this module's own verify-required plugin source (home-patch mount, the corrections pass). */
export function verifyPluginPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'verify.ts')
}

/** Absolute path of this module's own plan-vs-actual tripwire plugin source (home-patch mount, the corrections pass). */
export function tripwirePluginPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'tripwire.ts')
}

/** Absolute path of this module's own retry-judge plugin source (home-patch mount, the corrections pass). */
export function retryJudgePluginPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'retry-judge.ts')
}

/** Absolute path of this module's own mistake-ledger plugin source (home-patch mount, the corrections pass). */
export function mistakeLedgerPluginPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'mistake-ledger.ts')
}

/** Absolute path of this module's own pre-execute plugin source (home-patch mount, the corrections pass). */
export function preExecPluginPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'pre-execute.ts')
}

/** Absolute path of this module's own failure-signature memory plugin source (home-patch mount, the corrections pass). */
export function failureMemoryPluginPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'failure-memory.ts')
}

/** Absolute path of this module's own home-patch template (runtime emitter). */
export function homePatchTemplatePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'home-patch.yml')
}

/**
 * Materialize the per-session home patch at `$ATSH_HOME/cordis.patch.yml`.
 *
 * Rows:
 * - `session-persistence-jsonl`: plaintext JSONL (compression none, packChunks
 *   false) rooted at `$ATSH_HOME/sessions` — the row's `root` must be re-supplied
 *   because an id-targeted config override REPLACES the bundle row's config
 *   (verified live: omitting root → "root missing required value").
 * - `bench-pin-request` insert: the pin plugin mounted per session (a
 *   misbehaving pin can never leak across sessions — spec §5).
 * - `bench-loop-guard` insert (when `guard` is set): the loop-guard plugin
 *   mounting the per-task call ceiling + D4 accounting hook + D6 alarms + the
 *   "summarize & submit" fallback directive into the session composition
 *. Same single-session isolation as the pin — a broken guard
 *   cannot leak across sessions.
 *
 * @param atshHome - the fresh per-session home.
 * @param pin - pin values (model / temperature / maxTokens).
 * @param pinPlugin - absolute path of the pin plugin module.
 * @param guard - when present, mount the loop-guard with a per-task call ceiling
 *   (and optional D6 tuning + fallback directive) into the session composition.
 * @param guardPlugin - absolute path of the guard plugin module.
 * @param trace - when present, mount the serve-trace plugin with a sidecar path
 * writing one `live`-source record per `llm/stream` completion —
 *   the durable trace a re-run's short-circuit classifier reads.
 * @param tracePlugin - absolute path of the trace plugin module.
 * @param verify - when present, mount the verify-required plugin
 *   with the task prompt text so stale-knowledge verification-required prompts
 *   force a live upstream read (distinct purpose → llm-cache miss). Armed from
 *   the prompt, arm-agnostic like the guard and trace.
 * @param verifyPlugin - absolute path of the verify plugin module.
 * @param retryJudge - when present, mount the retry-judge plugin
 *   with a consecutive-retry ceiling, pivoting C1-style retry-storms before
 *   the N+1 retry.
 * @param retryJudgePlugin - absolute path of the retry-judge plugin module.
 * @param ledger - when present, mount the mistake-ledger plugin
 *   pinning one-line "already tried X, failed Y" records into a byte-stable
 *   core the model reads instead of re-deriving a failed re-try.
 * @param ledgerPlugin - absolute path of the mistake-ledger plugin module.
 * @returns the patch text (also written to disk).
 */
export function writeHomePatch(
  atshHome: string,
  pin: { model: string; temperature: number; maxTokens: number },
  pinPlugin: string = pinPluginPath(),
  guard?: { callCeiling: number; repeatedCallThreshold?: number; minOutputFraction?: number; fallbackDirectiveText?: string },
  guardPlugin: string = guardPluginPath(),
  trace?: { path: string },
  tracePlugin: string = tracePluginPath(),
  verify?: { prompt: string; patterns?: readonly string[]; verificationPurpose?: string },
  verifyPlugin: string = verifyPluginPath(),
  tripwire?: { planEstimatedToolCalls: number; tripRatio?: number; checkpointDirectiveText?: string },
  tripwirePlugin: string = tripwirePluginPath(),
  retryJudge?: { maxConsecutiveRetries?: number; pivotDirectiveText?: string },
  retryJudgePlugin: string = retryJudgePluginPath(),
  ledger?: { repeatDirectiveText?: string },
  ledgerPlugin: string = mistakeLedgerPluginPath(),
  preExecute?: { contractPath: string; testsPath: string; directiveText?: string },
  preExecutePlugin: string = preExecPluginPath(),
  failureMemory?: { repeatDirectiveText?: string },
  failureMemoryPlugin: string = failureMemoryPluginPath(),
  /** prompt-lume reducer grade (broaden-design §4.4). When set, emits an
   *  id-targeted override of the default-ON base `prompt-lume` row: a grade
   *  (low/med/high/xhigh) or `off` (enabled:false). Never re-inserts the row —
   *  the within-arm grade ladder replaces the cross-arm prompt-lume-vs-vanilla
   *  comparison. Omitted = leave the base default untouched. */
  promptLumeGrade?: 'low' | 'med' | 'high' | 'xhigh' | 'off',
): string {
  const insertRows = [
    `    - id: bench-pin-request
      name: ${JSON.stringify(pinPlugin)}
      config:
        model: ${JSON.stringify(pin.model)}
        temperature: ${pin.temperature}
        maxTokens: ${pin.maxTokens}`,
  ]
  const lumeOverride = promptLumeGrade === 'off'
    ? `- id: prompt-lume
  config:
    enabled: false
`
    : promptLumeGrade !== undefined
      ? `- id: prompt-lume
  config:
    reducerGrade: ${promptLumeGrade}
`
      : ''
  if (guard !== undefined) {
    const tuning = [
      guard.repeatedCallThreshold !== undefined ? `        repeatedCallThreshold: ${guard.repeatedCallThreshold}` : '',
      guard.minOutputFraction !== undefined ? `        minOutputFraction: ${guard.minOutputFraction}` : '',
      guard.fallbackDirectiveText !== undefined ? `        fallbackDirectiveText: ${JSON.stringify(guard.fallbackDirectiveText)}` : '',
    ].filter(line => line !== '').join('\n')
    insertRows.push(`    - id: bench-loop-guard
      name: ${JSON.stringify(guardPlugin)}
      config:
        callCeiling: ${guard.callCeiling}
${tuning}`)
  }
  if (trace !== undefined) {
    insertRows.push(`    - id: bench-serve-trace
      name: ${JSON.stringify(tracePlugin)}
      config:
        path: ${JSON.stringify(trace.path)}`)
  }
  if (verify !== undefined) {
    const verifyPatterns = verify.patterns !== undefined
      ? `\n        patterns: ${JSON.stringify(verify.patterns)}`
      : ''
    const verifyPurpose = verify.verificationPurpose !== undefined
      ? `\n        verificationPurpose: ${JSON.stringify(verify.verificationPurpose)}`
      : ''
    insertRows.push(`    - id: bench-verify-required
      name: ${JSON.stringify(verifyPlugin)}
      config:
        prompt: ${JSON.stringify(verify.prompt)}${verifyPatterns}${verifyPurpose}`)
  }
  if (tripwire !== undefined) {
    const tripTuning = tripwire.tripRatio !== undefined
      ? `\n        tripRatio: ${tripwire.tripRatio}`
      : ''
    const tripDirective = tripwire.checkpointDirectiveText !== undefined
      ? `\n        checkpointDirectiveText: ${JSON.stringify(tripwire.checkpointDirectiveText)}`
      : ''
    insertRows.push(`    - id: bench-tripwire
      name: ${JSON.stringify(tripwirePlugin)}
      config:
        planEstimatedToolCalls: ${tripwire.planEstimatedToolCalls}${tripTuning}${tripDirective}`)
  }
  if (retryJudge !== undefined) {
    const retryTuning = retryJudge.maxConsecutiveRetries !== undefined
      ? `\n        maxConsecutiveRetries: ${retryJudge.maxConsecutiveRetries}`
      : ''
    const retryDirective = retryJudge.pivotDirectiveText !== undefined
      ? `\n        pivotDirectiveText: ${JSON.stringify(retryJudge.pivotDirectiveText)}`
      : ''
    insertRows.push(`    - id: bench-retry-judge
      name: ${JSON.stringify(retryJudgePlugin)}
      config:
        maxConsecutiveRetries: ${retryJudge.maxConsecutiveRetries ?? 3}${retryTuning}${retryDirective}`)
  }
  if (ledger !== undefined) {
    const ledgerConfig = ledger.repeatDirectiveText !== undefined
      ? { repeatDirectiveText: ledger.repeatDirectiveText }
      : {}
    insertRows.push(`    - id: bench-mistake-ledger
      name: ${JSON.stringify(ledgerPlugin)}
      config: ${JSON.stringify(ledgerConfig)}`)
  }
  if (preExecute !== undefined) {
    const preCfg = preExecute.directiveText !== undefined
      ? { contractPath: preExecute.contractPath, testsPath: preExecute.testsPath, directiveText: preExecute.directiveText }
      : { contractPath: preExecute.contractPath, testsPath: preExecute.testsPath }
    insertRows.push(`    - id: bench-pre-execute
      name: ${JSON.stringify(preExecutePlugin)}
      config: ${JSON.stringify(preCfg)}`)
  }
  if (failureMemory !== undefined) {
    const fmCfg = failureMemory.repeatDirectiveText !== undefined
      ? { repeatDirectiveText: failureMemory.repeatDirectiveText }
      : {}
    insertRows.push(`    - id: bench-failure-memory
      name: ${JSON.stringify(failureMemoryPlugin)}
      config: ${JSON.stringify(fmCfg)}`)
  }
  const patch = `# bench session home patch — generated by bench-run, applied over every profile.
- id: session-persistence-jsonl
  config:
    root: !!js atshHomePath('sessions')
    compression: none
    packChunks: false
${lumeOverride}- insert:
${insertRows.join('\n')}
`
  mkdirSync(atshHome, { recursive: true })
  writeFileSync(join(atshHome, 'cordis.patch.yml'), patch)
  return patch
}

/**
 * Resolve the HEAD commit of a harness repo checkout, including worktrees
 * (`.git` is a file carrying `gitdir: <path>` — follow it before reading
 * HEAD/refs). Regular branch refs live in the COMMON git dir when the
 * checkout is a worktree (`commondir` file in the worktree gitdir) — a
 * worktree-local read of `refs/heads/...` misses them. Spec §9
 * reproducibility: the run log records the harness version, so a wrong or
 * missing head would invalidate the snapshot.
 */
function resolveRepoHead(harnessRepo: string): string {
  const gitPath = join(harnessRepo, '.git')
  let gitDir = gitPath
  try {
    if (!statSync(gitPath).isDirectory()) {
      const content = readFileSync(gitPath, 'utf8').trim()
      const match = /^gitdir:\s*(.+)$/.exec(content)
      if (match?.[1]) gitDir = resolve(harnessRepo, match[1].trim())
    }
  } catch {
    return 'unknown'
  }
  try {
    let head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5).trim()
      const candidates = [join(gitDir, ref)]
      try {
        const common = resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim())
        candidates.push(join(common, ref))
      } catch {
        // No commondir — this is a main checkout; refs are local to gitDir.
      }
      const found = candidates.find(candidate => existsSync(candidate))
      if (found) head = readFileSync(found, 'utf8').trim()
    }
    return head
  } catch {
    return 'unknown'
  }
}

/**
 * Compute the environment fingerprint for the run log (spec §5).
 * @param harnessRepo - repo whose HEAD is recorded.
 * @returns the fingerprint record.
 */
export async function fingerprint(harnessRepo: string): Promise<RunFingerprint> {
  const os = await import('node:os')
  const head = resolveRepoHead(harnessRepo)
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: `${os.cpus().length} x ${os.cpus()[0]?.model ?? 'unknown'}`,
    totalMemGb: Math.round(os.totalmem() / 1024 ** 3 * 10) / 10,
    harnessRepo,
    harnessRepoHead: head,
    dshProfile: 'headless',
  }
}

/**
 * Aggregate the cost sidecar for one session over its exported events
 * (spec §7). Reads TokenUsage from `assistant/message` events and
 * `assistant/chunk` usage events; absent fields are 0 and absence of usage
 * is counted as a data-quality flag.
 *
 * @param events - the exported session log events.
 * @param prices - the pinned price sheet.
 * @returns the session cost record.
 */
export function computeSessionCost(events: readonly SessionLogEvent[], prices: {
  uncachedInputPerMTok: number
  cachedInputPerMTok: number
  outputPerMTok: number
}): SessionCost {
  let inputTokens = 0
  let cachedInputTokens = 0
  let cacheWriteTokens = 0
  let outputTokens = 0
  let usageEvents = 0
  let missingUsageEvents = 0
  for (const event of events) {
    const usage = parseTokenUsage(event)
    if (!usage.hasTokenUsage) {
      // Spec §7 reads TokenUsage on assistant/message events; chunk events
      // are stream fragments and are not data-quality gaps on their own.
      if (event.type === 'assistant/message') missingUsageEvents += 1
      continue
    }
    usageEvents += 1
    inputTokens += usage.inputTokens
    cachedInputTokens += usage.cacheReadTokens
    cacheWriteTokens += usage.cacheWriteTokens
    outputTokens += usage.outputTokens
  }
  // Provider fields are DISJOINT: inputTokens is uncached input only, cached
  // input is reported separately (billed input = sum of the three). Verified
  // live on the bench host — subtracting cacheRead from inputTokens produced
  // a negative uncached count (-282k tokens on a real session).
  const uncachedInputTokens = inputTokens
  const totalInput = inputTokens + cachedInputTokens
  const cacheHitRate = totalInput > 0 ? cachedInputTokens / totalInput : 0
  const usd = (
    uncachedInputTokens / 1e6 * prices.uncachedInputPerMTok
    + cachedInputTokens / 1e6 * prices.cachedInputPerMTok
    + outputTokens / 1e6 * prices.outputPerMTok
  )
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    uncachedInputTokens,
    outputTokens,
    cacheHitRate,
    usd,
    usageEvents,
    missingUsageEvents,
  }
}

/**
 * Run one benchmark session and return its full outcome.
 *
 * Mechanics: fresh `$ATSH_HOME` under the output root, home patch written,
 * sandbox seeded (custom task micro-repo), harness spawned headless with
 * `ATSH_PERMISSION_MODE=danger-full-access` and the benchmark env, wall-clock
 * timeout enforced via `SIGKILL`, session log exported, classified, costed.
 *
 * @param options - session options.
 * @returns the session outcome (never throws on harness failure — failures
 * are recorded in the outcome).
 */
export async function runSession(options: SessionRunOptions): Promise<SessionOutcome> {
  const arm = options.arm
  const taskId = options.taskId
  const sessionDir = join(options.outputRoot, 'sessions', arm, taskId)
  const atshHome = join(sessionDir, 'home')
  const sandbox = join(sessionDir, 'sandbox')
  const logDir = join(options.outputRoot, 'session-logs', arm)
  mkdirSync(sandbox, { recursive: true })
  mkdirSync(atshHome, { recursive: true })
  mkdirSync(logDir, { recursive: true })

  // Fresh sandbox: copy the task micro-repo when one is provided.
  if (options.sandboxSeedDir) {
    cpSync(options.sandboxSeedDir, sandbox, { recursive: true })
  }

  // The tsx loader (`--import tsx/esm`) resolves from the process cwd — the
  // fresh sandbox, which has no node_modules. Expose the harness repo's
  // node_modules so the loader is found; the harness's own imports resolve
  // from the repo regardless of cwd (verified live: without this the boot
  // dies instantly with ERR_MODULE_NOT_FOUND for 'tsx').
  const harnessModules = join(options.harnessRepo, 'node_modules')
  if (existsSync(harnessModules)) {
    const sandboxModules = join(sandbox, 'node_modules')
    if (!existsSync(sandboxModules)) symlinkSync(harnessModules, sandboxModules, 'dir')
  }

  writeHomePatch(
    atshHome,
    {
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    },
    undefined, options.guard, undefined,
    undefined, undefined, options.verify, undefined,
    options.tripwire, undefined, options.retryJudge, undefined,
    options.ledger, undefined, options.preExecute, undefined,
    undefined, undefined, options.promptLumeGrade,
  )

  const env: Record<string, string> = {
    ...process.env,
    ATSH_HOME: atshHome,
    ATSH_PERMISSION_MODE: 'danger-full-access',
    ...options.env,
  }
  // tsx resolves the repo tsconfig from the process cwd — the fresh sandbox,
  // which has none. Point TSX_TSCONFIG_PATH at the harness repo's solution
  // file so package-name paths (@deepseek-ai/cordis -> vendor/cordis/src)
  // resolve the same way `pnpm atsh` does from the repo root. Verified live:
  // without it the boot dies with "does not provide an export named
  // 'FiberState'". Caller env can still override.
  const repoTsconfig = join(options.harnessRepo, 'tsconfig.json')
  if (existsSync(repoTsconfig) && env.TSX_TSCONFIG_PATH === undefined) {
    env.TSX_TSCONFIG_PATH = repoTsconfig
  }

  const bin = join(options.harnessRepo, 'apps', 'cli', 'src', 'bin.ts')
  const started = Date.now()
  let exitCode = -1
  let timedOut = false
  let stderrTail = ''

  if (!options.dryRun) {
    await new Promise<void>((resolvePromise) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx/esm', bin, '--profile', options.profile ?? 'headless', options.prompt],
        { cwd: sandbox, env, stdio: ['ignore', 'ignore', 'pipe'] },
      )
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
        if (stderr.length > 4096) stderr = stderr.slice(-4096)
      })
      const killer = setTimeout(() => {
        timedOut = true
        try { child.kill('SIGKILL') } catch { /* already gone */ }
      }, options.sessionTimeoutMs)
      child.on('close', (code) => {
        clearTimeout(killer)
        exitCode = code ?? -1
        stderrTail = stderr.slice(-2048)
        resolvePromise()
      })
      child.on('error', (error) => {
        clearTimeout(killer)
        stderrTail = String(error).slice(-2048)
        resolvePromise()
      })
    })
  }
  const elapsedSec = Math.round((Date.now() - started) / 1000)

  // Export the session log (spec §5: session-log export after each session).
  const newest = findNewestSessionLog(atshHome)
  const exported = join(logDir, `${taskId}.jsonl`)
  let events: SessionLogEvent[] = []
  let sessionId: string | undefined
  if (newest) {
    const loaded = readSessionLogFile(newest)
    if (loaded) {
      events = loaded.events
      sessionId = loaded.sessionId
      // tbench task ids carry a '/' (terminal-bench/<task>) — the export
      // parent dir does not exist, and a plain writeFileSync ENOENTs (the
      // the bench workstream clone-arm crash: first live tbench session killed the whole
      // 30-task run silently at 10/30). Create the parent recursively.
      mkdirSync(dirname(exported), { recursive: true })
      writeFileSync(exported, readFileSync(newest))
    }
  }

  // Classify + cost.
  const classifyConfig = options.classifyConfig
  const classify = classifySession(events, classifyConfig)
  const cost = computeSessionCost(events, options.prices)
  // Waste-ratio primary metric (broaden-design §2, §4.5): session aggregate +
  // per-turn segmentation. Pure function of the exported events.
  const waste = computeTurnWasteRatio(events)

  // Task verifier (custom tasks): run in the sandbox, sandbox as $1.
  let taskSuccess: boolean | null = null
  let verifierExit: number | null = null
  if (options.verifier && existsSync(options.verifier)) {
    if (options.dryRun) {
      verifierExit = 0
      taskSuccess = true
    } else {
      verifierExit = await runVerifier(options.verifier, sandbox, exported)
      taskSuccess = verifierExit === 0
    }
  }

  return {
    arm,
    taskId,
    sessionId,
    exitCode,
    timedOut: options.dryRun ? false : timedOut,
    logPath: exported,
    classify,
    cost,
    waste,
    taskSuccess,
    verifierExit,
    elapsedSec,
    stderrTail,
  }
}

/** Run a task verifier script in the sandbox; returns the exit code. */
export async function runVerifier(verifier: string, sandbox: string, sessionLog?: string): Promise<number> {
  return await new Promise<number>((resolvePromise) => {
    const args = [sandbox]
    if (sessionLog) args.push(sessionLog)
    const child = spawn(verifier, args, { cwd: sandbox, stdio: 'ignore' })
    child.on('close', (code) => { resolvePromise(code ?? -1) })
    child.on('error', () => { resolvePromise(-1) })
  })
}

/**
 * Aggregate per-arm results from session outcomes.
 * @param arm - the arm.
 * @param sessions - the session outcomes.
 * @returns the aggregated arm result.
 */
export function aggregateArm(arm: BenchArm, sessions: SessionOutcome[]): ArmRunResult {
  const classified = sessions.filter(s => s.classify.events > 0)
  const withCost = sessions.filter(s => s.cost.usageEvents > 0)
  const meanCorrections = classified.length > 0
    ? classified.reduce((sum, s) => sum + s.classify.total, 0) / classified.length
    : 0
  const totalCalls = classified.reduce((sum, s) => sum + s.classify.toolCalls, 0)
  const per100Calls = totalCalls > 0
    ? classified.reduce((sum, s) => sum + s.classify.total, 0) / totalCalls * 100
    : 0
  const attempted = sessions.filter(s => s.taskSuccess !== null)
  const successRate = attempted.length > 0
    ? attempted.filter(s => s.taskSuccess).length / attempted.length
    : null
  const meanCostUsd = withCost.length > 0
    ? withCost.reduce((sum, s) => sum + s.cost.usd, 0) / withCost.length
    : 0
  const meanCacheHitRate = withCost.length > 0
    ? withCost.reduce((sum, s) => sum + s.cost.cacheHitRate, 0) / withCost.length
    : 0
  return { arm, sessions, meanCorrections, per100Calls, successRate, meanCostUsd, meanCacheHitRate }
}

/**
 * Append one run-log entry to `<outputRoot>/run.log` (JSON line) and write
 * the fingerprint header on first use. The run log records the environment
 * fingerprint and the model pin (spec §5, §9).
 *
 * @param outputRoot - run output root.
 * @param fingerprint - the environment fingerprint.
 * @param pin - the model pin record.
 * @param entry - the session entry (omit to write only the header).
 * @param manifestSha256 - the resolved manifest identity hash.
 * @param eventName - run-log event name (default `session`; use `run-end`
 *   for the terminal marker, `session-error` for fault-isolation records).
 */
export function writeRunLog(
  outputRoot: string,
  fp: RunFingerprint,
  pin: { model: string; temperature: number; maxTokens: number },
  entry?: RunLogEntry,
  manifestSha256?: string,
  eventName: 'session' | 'session-error' | 'run-end' = 'session',
): void {
  const logPath = join(outputRoot, 'run.log')
  let resolvedSha = manifestSha256
  if (resolvedSha === undefined) {
    // Fallback for callers that do not resolve the manifest themselves:
    // look for the repo-root bench-manifest.json relative to the output root.
    const manifestPath = resolve(outputRoot, '..', '..', 'bench-manifest.json')
    const manifestText = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : ''
    resolvedSha = sha256Hex(manifestText)
  }
  const header = {
    event: 'run-start',
    fingerprint: fp,
    pin,
    manifestSha256: resolvedSha,
  }
  mkdirSync(outputRoot, { recursive: true })
  if (!existsSync(logPath)) {
    writeFileSync(logPath, `${JSON.stringify(header)}\n`)
  }
  if (entry) {
    writeFileSync(logPath, `${JSON.stringify({ event: eventName, ...entry })}\n`, { flag: 'a' })
  }
}

/** Build the run output root for a run id under a base dir. */
export function runOutputRoot(baseDir: string, runId: string): string {
  return join(baseDir, 'bench-runs', runId)
}

/** Create a short unique run id (UTC timestamp + random suffix). */
export function newRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}Z-${Math.random().toString(36).slice(2, 6)}`
}

/** Default session timeout: 30 minutes (spec §9). */
export const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000

/** Default temperature pin (spec §9). */
export const DEFAULT_TEMPERATURE = 0

/** Convenience: temp dir for ad-hoc runner use. */
export function benchTmpDir(prefix: string): string {
  return resolve(tmpdir(), prefix)
}

export { basename, join as joinPath }

/**
 * Unit tests for the bench runner (`bench-run`) — home-patch emission,
 * cost sidecar math, per-arm aggregation, run-log framing, and session
 * orchestration in dry-run mode.
 *
 * The harness boot + real model calls are NOT exercised here (that is the
 * live smoke run's job — spec §9 controls). Pure logic is tested against
 * fixture events modeled on the harness `SessionEvent` envelope.
 *
 * @module @atlasai/atsh-bench/run.spec
 */

import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  aggregateArm,
  computeSessionCost,
  fingerprint,
  newRunId,
  runOutputRoot,
  runSession,
  taskDescriptor,
  writeHomePatch,
  writeRunLog,
  isLumeGrade,
  LUME_GRADES,
  REDUCER_LADDER,
} from '../src/index.ts'
import type { SessionLogEvent } from '../src/index.ts'

/** One assistant message event carrying TokenUsage (spec §7 wire surface). */
function usageMessage(seq: number, usage: Record<string, number>): SessionLogEvent {
  return { type: 'assistant/message', seq, time: 1786923600000 + seq, data: { usage } }
}

/** One tool/call event (C1 material). */
function toolCall(seq: number, name: string): SessionLogEvent {
  return { type: 'tool/call', seq, time: 1786923600000 + seq, data: { name, arguments: {} } }
}

/** One tool/result with an error (C1 trigger). */
function toolError(seq: number, name: string): SessionLogEvent {
  return { type: 'tool/result', seq, time: 1786923600000 + seq, data: { name, error: { name: 'E', code: 'X' } } }
}

const PRICES = { uncachedInputPerMTok: 0.435, cachedInputPerMTok: 0.0033, outputPerMTok: 1.2 }

describe('bench-run home patch', () => {
  it('emits the JSONL plaintext override with root re-supplied', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-patch-'))
    const patch = writeHomePatch(home, { model: 'm', temperature: 0, maxTokens: 8192 })
    expect(patch).toContain("root: !!js atshHomePath('sessions')")
    expect(patch).toContain('compression: none')
    expect(patch).toContain('packChunks: false')
    expect(patch).toContain('bench-pin-request')
    expect(patch).toContain('temperature: 0')
    expect(patch).toContain('maxTokens: 8192')
    expect(patch).toContain('model: "m"')
    expect(existsSync(join(home, 'cordis.patch.yml'))).toBe(true)
    expect(readFileSync(join(home, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    rmSync(home, { recursive: true, force: true })
  })

  it('accepts an explicit pin plugin path', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-patch-'))
    const patch = writeHomePatch(home, { model: 'm', temperature: 0, maxTokens: 1 }, '/abs/pin.ts')
    expect(patch).toContain('name: "/abs/pin.ts"')
    rmSync(home, { recursive: true, force: true })
  })

  it('emits an id-targeted prompt-lume reducer override when a grade is set', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-patch-'))
    const grade = writeHomePatch(home, { model: 'm', temperature: 0, maxTokens: 8192 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'high')
    expect(grade).toContain('- id: prompt-lume')
    expect(grade).toContain('reducerGrade: high')
    expect(grade).not.toContain('enabled: false')
    // The override replaces, never re-inserts: exactly one prompt-lume id.
    expect(grade.match(/- id: prompt-lume/g)?.length).toBe(1)
    rmSync(home, { recursive: true, force: true })
  })

  it('emits enabled:false when the lume grade is off', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-patch-'))
    const patch = writeHomePatch(home, { model: 'm', temperature: 0, maxTokens: 8192 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'off')
    expect(patch).toContain('- id: prompt-lume')
    expect(patch).toContain('enabled: false')
    expect(patch).not.toContain('reducerGrade')
    expect(patch.match(/- id: prompt-lume/g)?.length).toBe(1)
    rmSync(home, { recursive: true, force: true })
  })

  it('leaves the base prompt-lume untouched when no grade is set', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-patch-'))
    const patch = writeHomePatch(home, { model: 'm', temperature: 0, maxTokens: 8192 })
    expect(patch).not.toContain('prompt-lume')
    rmSync(home, { recursive: true, force: true })
  })
})

describe('bench-run within-arm reducer-grade ladder (broaden-design §4.4, the prior workstream T5b)', () => {
  it('defines all five ladder cells: low, med, high, xhigh, off', () => {
    const grades = REDUCER_LADDER.map(row => row.grade)
    expect(grades).toEqual(['low', 'med', 'high', 'xhigh', 'off'])
  })

  it('orders the reduction grades from least to most aggressive with off last', () => {
    // low = widest hook (least reduction, most context); xhigh = narrowest
    // hook (most reduction, least context); off anchors the counterfactual.
    const input = REDUCER_LADDER
      .filter(row => row.inputTokens !== null)
      .map(row => row.inputTokens as number)
    for (let i = 1; i < input.length; i += 1) {
      expect(input[i]!).toBeLessThan(input[i - 1]!)
    }
    expect(REDUCER_LADDER[REDUCER_LADDER.length - 1]!.disabled).toBe(true)
  })

  it('exposes low/med/high/xhigh/off as the CLI-valid grade set', () => {
    expect(LUME_GRADES).toEqual(['low', 'med', 'high', 'xhigh', 'off'])
    expect(isLumeGrade('low')).toBe(true)
    expect(isLumeGrade('off')).toBe(true)
    expect(isLumeGrade('ultra')).toBe(false)
  })

  it('writes a per-grade id-targeted override for every reduction grade', () => {
    for (const row of REDUCER_LADDER) {
      const home = mkdtempSync(join(tmpdir(), 'bench-ladder-'))
      expect(writeHomePatch(home, { model: 'm', temperature: 0, maxTokens: 8192 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, row.grade)).toMatch(/- id: prompt-lume/)
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('bench-run cost sidecar (spec §7)', () => {
  it('sums disjoint token fields and computes the USD total', () => {
    const events: SessionLogEvent[] = [
      usageMessage(1, { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 600, cacheWriteTokens: 50 }),
      usageMessage(5, { inputTokens: 500, outputTokens: 100, cacheReadTokens: 200 }),
    ]
    const cost = computeSessionCost(events, PRICES)
    expect(cost.inputTokens).toBe(1500)
    expect(cost.cachedInputTokens).toBe(800)
    // Provider fields are disjoint — inputTokens IS uncached input.
    expect(cost.uncachedInputTokens).toBe(1500)
    expect(cost.outputTokens).toBe(300)
    expect(cost.cacheWriteTokens).toBe(50)
    expect(cost.cacheHitRate).toBeCloseTo(800 / 2300, 6)
    const expectedUsd = 1500 / 1e6 * 0.435 + 800 / 1e6 * 0.0033 + 300 / 1e6 * 1.2
    expect(cost.usd).toBeCloseTo(expectedUsd, 9)
    expect(cost.usageEvents).toBe(2)
    expect(cost.missingUsageEvents).toBe(0)
  })

  it('treats absent TokenUsage as 0 and counts the data-quality flag', () => {
    const events: SessionLogEvent[] = [
      usageMessage(1, { inputTokens: 100, outputTokens: 10 }),
      { type: 'assistant/message', seq: 2, time: 1, data: { content: [{ type: 'text', text: 'no usage' }] } },
      toolCall(3, 'bash'),
    ]
    const cost = computeSessionCost(events, PRICES)
    expect(cost.inputTokens).toBe(100)
    expect(cost.missingUsageEvents).toBe(1)
    expect(cost.cacheHitRate).toBe(0)
    expect(cost.usageEvents).toBe(1)
  })

  it('does not flag usage-less assistant/chunk stream fragments', () => {
    const events: SessionLogEvent[] = [
      usageMessage(1, { inputTokens: 100 }),
      { type: 'assistant/chunk', seq: 2, time: 1, data: { chunk: { type: 'content', text: 'x' } } },
    ]
    const cost = computeSessionCost(events, PRICES)
    expect(cost.missingUsageEvents).toBe(0)
    expect(cost.usageEvents).toBe(1)
  })

  it('returns zero cost for an eventless session', () => {
    const cost = computeSessionCost([], PRICES)
    expect(cost.usd).toBe(0)
    expect(cost.cacheHitRate).toBe(0)
    expect(cost.missingUsageEvents).toBe(0)
  })
})

describe('bench-run aggregation', () => {
  it('computes mean corrections, per-100-calls, success rate, and cost', () => {
    const makeOutcome = (total: number, toolCalls: number, ok: boolean | null, usd: number, cacheHit: number) => ({
      arm: 'clone' as const,
      taskId: 't',
      sessionId: 's',
      exitCode: 0,
      timedOut: false,
      logPath: '/tmp/x.jsonl',
      classify: {
        sessionId: 's',
        events: 10,
        toolCalls,
        counts: { C1: total, C2: 0, C3: 0, C4: 0, C5: 0 },
        total,
        per100Calls: toolCalls > 0 ? total / toolCalls * 100 : 0,
        hits: [],
      },
      cost: {
        inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, uncachedInputTokens: 0, outputTokens: 0,
        cacheHitRate: cacheHit, usd, usageEvents: usd > 0 ? 1 : 0, missingUsageEvents: 0,
      },
      waste: {
        session: { totalCalls: toolCalls, errorCalls: 0, noopEdits: 0, postOutcomeCalls: 0, wastedCalls: 0, wasteRatio: 0 },
        turns: [],
      },
      taskSuccess: ok,
      verifierExit: ok === null ? null : ok ? 0 : 1,
      elapsedSec: 10,
      stderrTail: '',
    })
    const sessions = [
      makeOutcome(2, 10, true, 0.1, 0.5),
      makeOutcome(4, 20, false, 0.2, 0.8),
    ]
    const aggregated = aggregateArm('clone', sessions)
    expect(aggregated.meanCorrections).toBe(3)
    expect(aggregated.per100Calls).toBeCloseTo(6 / 30 * 100, 6)
    expect(aggregated.successRate).toBe(0.5)
    expect(aggregated.meanCostUsd).toBeCloseTo(0.15, 9)
    expect(aggregated.meanCacheHitRate).toBeCloseTo(0.65, 9)
  })

  it('handles an empty session list without NaN', () => {
    const aggregated = aggregateArm('additive', [])
    expect(aggregated.meanCorrections).toBe(0)
    expect(aggregated.successRate).toBe(null)
    expect(aggregated.meanCostUsd).toBe(0)
    expect(aggregated.per100Calls).toBe(0)
  })
})

describe('bench-run run log', () => {
  it('writes a fingerprint header + session entries as JSON lines', () => {
    const root = mkdtempSync(join(tmpdir(), 'bench-runlog-'))
    const fp = {
      nodeVersion: process.version,
      platform: 'linux',
      arch: 'x64',
      cpus: '1 x test',
      totalMemGb: 1,
      harnessRepo: '/tmp/repo',
      harnessRepoHead: 'abc123',
      dshProfile: 'headless',
    }
    writeRunLog(root, fp, { model: 'm', temperature: 0, maxTokens: 8192 })
    writeRunLog(root, fp, { model: 'm', temperature: 0, maxTokens: 8192 }, {
      arm: 'clone', taskId: 't1', sessionId: 's1', exitCode: 0, timedOut: false,
      elapsedSec: 5, taskSuccess: true, total: 1, per100Calls: 2, costUsd: 0.01, cacheHitRate: 0.5,
      wasteRatio: 0.25, turnCount: 2,
      turns: [
        { turn: 0, totalCalls: 2, wastedCalls: 1, wasteRatio: 0.5 },
        { turn: 1, totalCalls: 2, wastedCalls: 0, wasteRatio: 0 },
      ],
    })
    const lines = readFileSync(join(root, 'run.log'), 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    const header = JSON.parse(lines[0]!) as { event: string; fingerprint: RunFingerprintLike; pin: { temperature: number } }
    expect(header.event).toBe('run-start')
    expect(header.fingerprint.nodeVersion).toBe(process.version)
    expect(header.pin.temperature).toBe(0)
    const entry = JSON.parse(lines[1]!) as { event: string; taskId: string; wasteRatio: number; turnCount: number }
    expect(entry.event).toBe('session')
    expect(entry.taskId).toBe('t1')
    expect(entry.wasteRatio).toBe(0.25)
    expect(entry.turnCount).toBe(2)
    rmSync(root, { recursive: true, force: true })
  })
})

type RunFingerprintLike = {
  nodeVersion: string
  platform: string
  arch: string
  cpus: string
  totalMemGb: number
  harnessRepo: string
  harnessRepoHead: string
  dshProfile: string
}

describe('bench-run session orchestration (dry run)', () => {
  it('runs a dry session end-to-end: sandbox seeded, log exported, counts + cost', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bench-session-'))
    const seed = mkdtempSync(join(tmpdir(), 'bench-seed-'))
    writeFileSync(join(seed, 'file.txt'), 'hello')
    const home = join(root, 'sessions', 'clone', 't1', 'home')
    // Simulate a persisted session log the way the JSONL backend writes it.
    const logFile = join(home, 'sessions', 'proj', 's1', 'session.jsonl')
    mkdirSync(join(home, 'sessions', 'proj', 's1'), { recursive: true })
    writeFileSync(logFile, [
      JSON.stringify({ type: 'session', id: 's1' }),
      JSON.stringify(usageMessage(1, { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500 })),
      JSON.stringify(toolCall(2, 'bash')),
      JSON.stringify(toolError(3, 'bash')),
      JSON.stringify(toolCall(4, 'bash')),
    ].join('\n') + '\n')
    const outcome = await runSession({
      arm: 'clone',
      taskId: 't1',
      prompt: 'do the thing',
      sandboxSeedDir: seed,
      harnessRepo: '/tmp/repo',
      profile: 'headless',
      model: 'm',
      temperature: 0,
      maxTokens: 8192,
      sessionTimeoutMs: 30000,
      outputRoot: root,
      prices: PRICES,
      dryRun: true,
    })
    expect(outcome.exitCode).toBe(-1)
    expect(outcome.timedOut).toBe(false)
    expect(outcome.classify.events).toBeGreaterThanOrEqual(3)
    expect(outcome.classify.counts.C1).toBe(1)
    expect(outcome.cost.inputTokens).toBe(1000)
    expect(existsSync(join(root, 'session-logs', 'clone', 't1.jsonl'))).toBe(true)
    expect(readdirSync(join(root, 'sessions', 'clone', 't1', 'sandbox')).includes('file.txt')).toBe(true)
    rmSync(root, { recursive: true, force: true })
    rmSync(seed, { recursive: true, force: true })
  })

  it('exports slash-id (tbench) task logs to a nested session-logs dir', async () => {
    // tbench task ids carry a '/' (terminal-bench/<task>). The export parent
    // dir does not exist and a plain writeFileSync ENOENTs — the runner died
    // silently at the first live tbench session (10/30). The export must
    // create the parent recursively.
    const root = mkdtempSync(join(tmpdir(), 'bench-slash-'))
    const seed = mkdtempSync(join(tmpdir(), 'bench-slash-seed-'))
    writeFileSync(join(seed, 'file.txt'), 'hello')
    const taskId = 'terminal-bench/bun-sourcemap-leak'
    const home = join(root, 'sessions', 'clone', taskId, 'home')
    const logFile = join(home, 'sessions', 'proj', 's1', 'session.jsonl')
    mkdirSync(join(home, 'sessions', 'proj', 's1'), { recursive: true })
    writeFileSync(logFile, [
      JSON.stringify({ type: 'session', id: 's1' }),
      JSON.stringify(usageMessage(1, { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500 })),
    ].join('\n') + '\n')
    const outcome = await runSession({
      arm: 'clone',
      taskId,
      prompt: 'do the thing',
      sandboxSeedDir: seed,
      harnessRepo: '/tmp/repo',
      profile: 'headless',
      model: 'm',
      temperature: 0,
      maxTokens: 8192,
      sessionTimeoutMs: 30000,
      outputRoot: root,
      prices: PRICES,
      dryRun: true,
    })
    expect(outcome.logPath).toBe(join(root, 'session-logs', 'clone', `${taskId}.jsonl`))
    expect(existsSync(outcome.logPath)).toBe(true)
    expect(outcome.cost.inputTokens).toBe(1000)
    rmSync(root, { recursive: true, force: true })
    rmSync(seed, { recursive: true, force: true })
  })

  it('exposes the harness node_modules to the sandbox so the tsx loader resolves', async () => {
    // The harness spawns with cwd = the fresh sandbox; `--import tsx/esm`
    // resolves from cwd, so without a node_modules link the boot dies with
    // ERR_MODULE_NOT_FOUND for 'tsx' (verified live on the bench host).
    const root = mkdtempSync(join(tmpdir(), 'bench-link-'))
    const harness = mkdtempSync(join(tmpdir(), 'bench-harness-'))
    mkdirSync(join(harness, 'node_modules'))
    const outcome = await runSession({
      arm: 'clone',
      taskId: 't1',
      prompt: 'x',
      harnessRepo: harness,
      profile: 'headless',
      model: 'm',
      temperature: 0,
      maxTokens: 8192,
      sessionTimeoutMs: 30000,
      outputRoot: root,
      prices: PRICES,
      dryRun: true,
    })
    expect(outcome.exitCode).toBe(-1)
    const link = join(root, 'sessions', 'clone', 't1', 'sandbox', 'node_modules')
    expect(existsSync(link)).toBe(true)
    expect(statSync(link).isDirectory()).toBe(true)
    rmSync(root, { recursive: true, force: true })
    rmSync(harness, { recursive: true, force: true })
  })
})

describe('bench-run helpers', () => {
  it('creates unique run ids and nested output roots', () => {
    const id1 = newRunId()
    const id2 = newRunId()
    expect(id1).not.toBe(id2)
    expect(runOutputRoot('/base', 'r1')).toBe(join('/base', 'bench-runs', 'r1'))
  })

  it('fingerprints the current environment', async () => {
    const fp = await fingerprint(process.cwd())
    expect(fp.nodeVersion).toBe(process.version)
    expect(fp.platform.length).toBeGreaterThan(0)
    expect(fp.totalMemGb).toBeGreaterThan(0)
  })
})

describe('bench-run tbench task descriptors (T8 materialization)', () => {
  it('maps a tbench task to instruction prompt + environment seed + local verifier', () => {
    const root = mkdtempSync(join(tmpdir(), 'bench-tbench-'))
    const taskDir = join(root, 'tasks', 'demo-task')
    const envDir = join(taskDir, 'environment')
    mkdirSync(join(envDir, 'src'), { recursive: true })
    writeFileSync(join(taskDir, 'instruction.md'), 'Fix the leak in src/index.ts and keep tests green.')
    writeFileSync(join(envDir, 'src', 'index.ts'), 'export const x = 1')
    const manifestPath = join(root, 'bench-manifest.json')
    writeFileSync(manifestPath, JSON.stringify({
      custom: { tasks: [] },
      tbench: { tasks: [{ id: 'terminal-bench/demo-task', instruction: 'ignored', path: 'tasks/demo-task' }] },
    }))
    const old = process.env.TBENCH_CHECKOUT
    process.env.TBENCH_CHECKOUT = root
    try {
      const d = taskDescriptor(manifestPath, 'terminal-bench/demo-task')
      expect(d.prompt).toBe('Fix the leak in src/index.ts and keep tests green.')
      expect(d.sandboxSeedDir).toBe(envDir)
      expect(d.verifier).toMatch(/tbench-verify\.sh$/)
      // Unknown tbench id falls back to the generic prompt, no seed, no verifier.
      const unknown = taskDescriptor(manifestPath, 'terminal-bench/does-not-exist')
      expect(unknown.prompt).toBe('Complete the task terminal-bench/does-not-exist')
      expect(unknown.sandboxSeedDir).toBeUndefined()
    } finally {
      if (old === undefined) delete process.env.TBENCH_CHECKOUT
      else process.env.TBENCH_CHECKOUT = old
      rmSync(root, { recursive: true, force: true })
    }
  })
})

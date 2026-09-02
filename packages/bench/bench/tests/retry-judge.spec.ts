/**
 * Self-targeted tests for the bench retry-judge.
 *
 * Verifies (self-targeted fast spec — deferred-verification contract, no full
 * suite run):
 * 1. The bench PRESET (home patch) composes the `bench-retry-judge` row when a
 *    consecutive-retry ceiling is configured — the judge is ACTIVE in the
 *    session composition (writeHomePatch is arm-agnostic).
 * 2. The pure storm decision: a designed retry-storm — a tool that fails, is
 *    retried, fails again, retried again — is PIVOTED by the judge BEFORE the
 *    (maxConsecutiveRetries + 1)th retry: `retryJudgeVerdict` stops when
 *    previousFailures exceeds the ceiling, allowing retries within it.
 * 3. The pivot builder: a vetoed tool result carries the pivot directive, is
 *    an `isError`, and has the distinct RETRY_STORM_VETOED error code the
 *    downstream log can key on.
 *
 * Mirror of the guard.spec patterns (T6/T7); the judge runs the same pure
 * decision + veto-result test shape.
 *
 * @module @atlasai/atsh-bench/retry-judge.spec
 */

import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PIVOT_DIRECTIVE,
  retryJudgePivotResult,
  retryJudgeVerdict,
  writeHomePatch,
} from '../src/index.ts'

describe('bench preset retry-judge composition (T17)', () => {
  it('emits the bench-retry-judge row when a retry ceiling is configured', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-retry-patch-'))
    const patch = writeHomePatch(
      home,
      { model: 'm', temperature: 0, maxTokens: 8192 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { maxConsecutiveRetries: 3 },
    )
    expect(patch).toContain('bench-retry-judge')
    expect(patch).toContain('maxConsecutiveRetries: 3')
    expect(existsSync(join(home, 'cordis.patch.yml'))).toBe(true)
    expect(readFileSync(join(home, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    rmSync(home, { recursive: true, force: true })
  })

  it('emits NO retry-judge row by default (no ceiling configured)', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-retry-none-'))
    const patch = writeHomePatch(home, { model: 'm', temperature: 0, maxTokens: 8192 })
    expect(patch).not.toContain('bench-retry-judge')
    rmSync(home, { recursive: true, force: true })
  })
})

describe('bench retry-judge storm decision (retryJudgeVerdict)', () => {
  it('allows retries WITHIN the ceiling', () => {
    // ceiling 3: previousFailures 0..3 are NOT the N+1 retry — allowed.
    for (const previousFailures of [0, 1, 2, 3]) {
      expect(retryJudgeVerdict({ previousFailures, maxConsecutive: 3 })).toEqual({
        stop: false,
        reason: null,
      })
    }
  })

  it('stops the retry AFTER the ceiling — the N+1 retry (previousFailures > ceiling)', () => {
    // The tool has already failed 4 times consecutively: the next call is the
    // 4th retry at ceiling 3 — the (N+1)th retry the judge must stop.
    expect(retryJudgeVerdict({ previousFailures: 4, maxConsecutive: 3 })).toEqual({
      stop: true,
      reason: 'retry-storm',
    })
  })

  it('stops the immediate second failure at ceiling 1 (before the N+1 retry)', () => {
    // ceiling 1: one retry allowed; the SECOND failure is the N+1 → stop.
    expect(retryJudgeVerdict({ previousFailures: 1, maxConsecutive: 1 })).toEqual({
      stop: false,
      reason: null,
    })
    expect(retryJudgeVerdict({ previousFailures: 2, maxConsecutive: 1 })).toEqual({
      stop: true,
      reason: 'retry-storm',
    })
  })
})

describe('bench retry-judge pivot result builder (retryJudgePivotResult)', () => {
  it('builds an isError veto carrying the pivot directive and storm code', () => {
    const result = retryJudgePivotResult('bash', 4, 3)
    expect(result.isError).toBe(true)
    expect(result.error?.info.code).toBe('RETRY_STORM_VETOED')
    expect(result.error?.info.name).toBe('RetryStormVetoedError')
    expect(result.content[0]?.text).toContain(DEFAULT_PIVOT_DIRECTIVE)
    expect(result.content[0]?.text).toContain('retry-storm')
    expect(result.error?.message).toContain('bash')
  })

  it('honors a custom pivot directive', () => {
    const custom = 'STOP this tool and try a completely different command.'
    const result = retryJudgePivotResult('read', 5, 2, custom)
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain(custom)
    expect(result.content[0]?.text).not.toContain(DEFAULT_PIVOT_DIRECTIVE)
  })
})

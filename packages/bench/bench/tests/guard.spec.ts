/**
 * Self-targeted tests for the bench loop-guard.
 *
 * Verifies (self-targeted fast spec — deferred-verification contract, no full
 * suite run):
 * 1. The bench PRESET (home patch) composes the `bench-loop-guard` row when a
 *    per-task call ceiling is configured — the guard rows are ACTIVE in the
 *    session composition for both arms (writeHomePatch is arm-agnostic).
 * 2. The pure over-run decision: a designed over-run session is stopped by the
 *    call ceiling (loopGuardVerdict returns `call-ceiling` at N >= ceiling),
 *    and the D4 accounting-cap / D6 flags each stop with their own reason.
 * 3. The D6 fold over the REAL alarm detectors: a repeated-call run escalates
 *    to a critical stop, and a P-Ratio collapse trips the efficiency alarm.
 *
 * @module @atlasai/atsh-bench/guard.spec
 */

import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendTierDirective,
  DEFAULT_FALLBACK_DIRECTIVE,
  foldGuard6M,
  FORCE_PLAN_RECHECK_DIRECTIVE,
  guardTierDecision,
  guardVetoResult,
  GUARD_TIER_RATIOS,
  loopGuardVerdict,
  MODEL_ESCALATE_DIRECTIVE,
  RE_READ_CONTRACT_DIRECTIVE,
  writeHomePatch,
} from '../src/index.ts'
import type { GuardRuntimeEvent, GuardToolResult } from '../src/index.ts'

/** One consecutive same-tool tool/call event pair builder for the D6 fold. */
function toolRun(seqBase: number, tool: string, count: number): GuardRuntimeEvent[] {
  const events: GuardRuntimeEvent[] = []
  for (let i = 0; i < count; i += 1) {
    events.push({ kind: 'tool/call', seq: seqBase + i, ts: 1786923600000 + i, tool })
  }
  return events
}

describe('bench preset loop-guard composition (T6)', () => {
  it('emits the bench-loop-guard row when a call ceiling is configured', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-guard-patch-'))
    const patch = writeHomePatch(
      home,
      { model: 'm', temperature: 0, maxTokens: 8192 },
      undefined,
      { callCeiling: 5 },
    )
    expect(patch).toContain('bench-loop-guard')
    expect(patch).toContain('callCeiling: 5')
    // Both arms get the same per-session patch: writeHomePatch is arm-agnostic
    // and the row is present along with the existing pin row.
    expect(patch).toContain('bench-pin-request')
    expect(existsSync(join(home, 'cordis.patch.yml'))).toBe(true)
    expect(readFileSync(join(home, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    rmSync(home, { recursive: true, force: true })
  })

  it('emits the guard row WITHOUT guard rows by default (no guard)', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-guard-none-'))
    const patch = writeHomePatch(home, { model: 'm', temperature: 0, maxTokens: 8192 })
    expect(patch).not.toContain('bench-loop-guard')
    rmSync(home, { recursive: true, force: true })
  })

  it('threads optional D6 tuning into the guard row', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-guard-tune-'))
    const patch = writeHomePatch(
      home,
      { model: 'm', temperature: 0, maxTokens: 8192 },
      undefined,
      { callCeiling: 3, repeatedCallThreshold: 4, minOutputFraction: 0.2 },
    )
    expect(patch).toContain('bench-loop-guard')
    expect(patch).toContain('repeatedCallThreshold: 4')
    expect(patch).toContain('minOutputFraction: 0.2')
    rmSync(home, { recursive: true, force: true })
  })
})

describe('bench loop-guard decision (loopGuardVerdict)', () => {
  it('stops a designed over-run session at the call ceiling', () => {
    // callCeiling 3 allows calls 1-2 (toolCalls < 3); the 3rd call grounds the
    // over-run: toolCalls 3 >= 3 is vetoed by the ceiling.
    expect(loopGuardVerdict({
      toolCalls: 2,
      callCeiling: 3,
      accountExceeded: false,
      repeatedCallCritical: false,
      pRatioRaised: false,
    })).toEqual({ stop: false, reason: null })
    expect(loopGuardVerdict({
      toolCalls: 3,
      callCeiling: 3,
      accountExceeded: false,
      repeatedCallCritical: false,
      pRatioRaised: false,
    })).toEqual({ stop: true, reason: 'call-ceiling' })
  })

  it('ranks the D4 accounting cap as the strongest stop', () => {
    const verdict = loopGuardVerdict({
      toolCalls: 100,
      callCeiling: 3,
      accountExceeded: true,
      repeatedCallCritical: true,
      pRatioRaised: true,
    })
    expect(verdict).toEqual({ stop: true, reason: 'accounting-cap' })
  })

  it('stops on the D6 P-Ratio and repeated-call flags in priority order', () => {
    expect(loopGuardVerdict({ toolCalls: 1, callCeiling: 999, accountExceeded: false, repeatedCallCritical: false, pRatioRaised: true })).toEqual({ stop: true, reason: 'p-ratio' })
    expect(loopGuardVerdict({ toolCalls: 1, callCeiling: 999, accountExceeded: false, repeatedCallCritical: true, pRatioRaised: false })).toEqual({ stop: true, reason: 'repeated-call' })
  })
})

describe('loop-guard D6 fold over the REAL alarm detectors (foldGuard6M)', () => {
  it('trips on a designed repeated-call run (critical escalation)', () => {
    // 4 consecutive same-tool calls: repeatThreshold 3 → warning at 3,
    // critical at 4 → the fold stops the session.
    const verdict = foldGuard6M(toolRun(1, 'bash', 4))
    expect(verdict.stop).toBe(true)
    expect(verdict.reason).toBe('repeated-call')
  })

  it('does not trip on a healthy interleaved stream', () => {
    // Different tools interleaved break any strict consecutive run.
    const events: GuardRuntimeEvent[] = [
      ...toolRun(1, 'bash', 2),
      { kind: 'model/call', seq: 9, ts: Date.now(), model: 'm', inputTokens: 800, outputTokens: 600 },
      ...toolRun(10, 'read', 2),
    ]
    expect(foldGuard6M(events).stop).toBe(false)
  })

  it('trips on a P-Ratio efficiency collapse', () => {
    // 1000 input / 10 output → ratio 0.0099 < 0.15 → P-Ratio alarm stops it.
    const events: GuardRuntimeEvent[] = [
      { kind: 'model/call', seq: 1, ts: Date.now(), model: 'm', inputTokens: 1000, outputTokens: 10 },
    ]
    const verdict = foldGuard6M(events)
    expect(verdict.stop).toBe(true)
    expect(verdict.reason).toBe('p-ratio')
  })

  it('honors the configured repeated-call threshold', () => {
    // With repeatThreshold 6, a 4-run is NOT a stop.
    expect(foldGuard6M(toolRun(1, 'bash', 4), { repeatedCallThreshold: 6 }).stop).toBe(false)
  })
})

describe('forced "summarize & submit" fallback on ceiling trip', () => {
  it('embeds the summarize & submit directive in every vetoed result', () => {
    const result = guardVetoResult('call-ceiling', 7, 5)
    const text = result.content[0]?.text ?? ''
    expect(result.isError).toBe(true)
    expect(result.error?.info.code).toBe('BUDGET_EXCEEDED')
    expect(text).toContain('call-ceiling')
    expect(text.toLowerCase()).toContain('summar')
    expect(text.toLowerCase()).toContain('submit')
    expect(text.toLowerCase()).toContain('final summary')
  })

  it('default directive instructs stop + submit (the fallback, not a hang)', () => {
    const text = DEFAULT_FALLBACK_DIRECTIVE
    expect(text.toLowerCase()).toContain('must not call any more tools')
    expect(text.toLowerCase()).toContain('write a concise final summary')
    expect(text.toLowerCase()).toContain('stop')
    expect(text.toLowerCase()).toContain('submit')
    // The directive must NOT suggest retry or continue — that would be a hang.
    expect(text.toLowerCase()).not.toContain('retry')
    expect(text.toLowerCase()).not.toContain('try again')
  })

  it('a designed over-run trip yields the fallback summary event (no silent hang)', () => {
    // Simulate an over-run session: callCeiling 4, the 4th call trips.
    const verdict = loopGuardVerdict({
      toolCalls: 4,
      callCeiling: 4,
      accountExceeded: false,
      repeatedCallCritical: false,
      pRatioRaised: false,
    })
    expect(verdict.stop).toBe(true)
    expect(verdict.reason).toBe('call-ceiling')
    // The vetoed result the model receives IS the fallback: a summary directive.
    const veto: GuardToolResult = guardVetoResult(
      verdict.reason as 'call-ceiling',
      4,
      4,
    )
    expect(veto.isError).toBe(true)
    // A model honoring the directive produces a no-tool-call final message;
    // the classifier sees the summary. The fallback SUMMARY EVENT in the log is
    // the final assistant summary, not a bare error that leaves the loop running.
    expect(veto.content[0]?.text.toLowerCase()).toContain('write a concise final summary')
    // Sticky veto: any later call returns the SAME veto, so no tool can run
    // again — the session cannot grind toward the wall clock.
    for (let i = 0; i < 3; i += 1) {
      const again = guardVetoResult('call-ceiling', 4, 4)
      expect(again.isError).toBe(true)
      expect(again.error?.info.code).toBe('BUDGET_EXCEEDED')
    }
  })

  it('custom fallback directive threads through the preset composition', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-guard-fb-'))
    const custom = 'STOP now and submit a summary. Absolutely no more tools.'
    const patch = writeHomePatch(
      home,
      { model: 'm', temperature: 0, maxTokens: 8192 },
      undefined,
      { callCeiling: 3, fallbackDirectiveText: custom },
    )
    expect(patch).toContain('fallbackDirectiveText')
    expect(patch).toContain('STOP now and submit a summary')
    rmSync(home, { recursive: true, force: true })
  })
})

describe('graded loop-guard ladder', () => {
  it('is silent below the 40% threshold', () => {
    // 3/10 = 0.3 → below reRead 0.4 → no tier, no directive.
    const d = guardTierDecision(3, 10)
    expect(d.tier).toBeNull()
    expect(d.directive).toBeNull()
    expect(d.ratio).toBeCloseTo(0.3)
  })

  it('fires re-read-contract at 40% of ceiling', () => {
    // 4/10 = 0.4 → re-read-contract.
    const d = guardTierDecision(4, 10)
    expect(d.tier).toBe('re-read-contract')
    expect(d.directive).toBe(RE_READ_CONTRACT_DIRECTIVE)
  })

  it('fires force-plan-recheck at 65% of ceiling', () => {
    // 7/10 = 0.7 >= 0.65 → plan-recheck.
    const d = guardTierDecision(7, 10)
    expect(d.tier).toBe('force-plan-recheck')
    expect(d.directive).toBe(FORCE_PLAN_RECHECK_DIRECTIVE)
  })

  it('fires model-escalate at 85% of ceiling', () => {
    // 9/10 = 0.9 >= 0.85 → model-escalate.
    const d = guardTierDecision(9, 10)
    expect(d.tier).toBe('model-escalate')
    expect(d.directive).toBe(MODEL_ESCALATE_DIRECTIVE)
  })

  it('returns veto at 100% of ceiling (kept, with fallback directive)', () => {
    // 10/10 = 1.0 >= 1.0 → veto tier (the existing hard stop).
    const d = guardTierDecision(10, 10)
    expect(d.tier).toBe('veto')
    expect(d.directive).toBe(DEFAULT_FALLBACK_DIRECTIVE)
  })

  it('exposes the ratio constants as expected fractions', () => {
    expect(GUARD_TIER_RATIOS.reRead).toBe(0.4)
    expect(GUARD_TIER_RATIOS.planRecheck).toBe(0.65)
    expect(GUARD_TIER_RATIOS.escalate).toBe(0.85)
    expect(GUARD_TIER_RATIOS.veto).toBe(1.0)
  })

  it('directive text names the tier and is advisory (no veto code)', () => {
    for (const d of [RE_READ_CONTRACT_DIRECTIVE, FORCE_PLAN_RECHECK_DIRECTIVE, MODEL_ESCALATE_DIRECTIVE]) {
      expect(d.toLowerCase()).not.toContain('stood')
      expect(d.toLowerCase()).not.toContain('can not run')
      expect(d).toBeTruthy()
    }
  })

  it('appendTierDirective returns a NEW result and leaves the input untouched', () => {
    const base: GuardToolResult = {
      content: [{ type: 'text', text: 'original output' }],
      isError: false,
    }
    const merged = appendTierDirective(base, '[graded-tier:re-read-contract] re-read it')
    // Input is untouched (immutability golden rule).
    expect(base.content).toHaveLength(1)
    expect(base.content[0]?.text).toBe('original output')
    // Merged carries both the original content and the appended directive.
    expect(merged).not.toBe(base)
    expect(merged.content).toHaveLength(2)
    expect(merged.content.map(c => c.text)).toContain('original output')
    expect(merged.content.map(c => c.text)).toContain('[graded-tier:re-read-contract] re-read it')
  })

  it('veto tier does NOT double-fire as an advisory (100% always vetoes)', () => {
    // The ladder never returns an advisory directive at/over veto ratio.
    const d = guardTierDecision(12, 10)
    expect(d.tier).toBe('veto')
    expect(d.directive).toBe(DEFAULT_FALLBACK_DIRECTIVE)
  })
})

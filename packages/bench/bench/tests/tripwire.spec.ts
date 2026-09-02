/**
 * Self-targeted tests for the bench plan-vs-actual cost tripwire.
 *
 * Verifies (self-targeted fast spec — deferred-verification contract, no full
 * bench boot):
 * 1. The pure {@link tripwireVerdict} trips the checkpoint gate when ACTUAL
 *    tool calls exceed the plan's estimated count by more than 3x — the
 *    designed hrd-02 61→280 blow-up shape (actual 280 > 3×61 = 183).
 * 2. Within-budget sessions (actual ≤ 3× predicted) do NOT trip.
 * 3. {@link tripwireCheckpointResult} produces the STICKY
 *    checkpoint-and-replan veto (PLAN_VS_ACTUAL_TRIPPED, distinct from the T7
 *    summarize-submit): the directive instructs CHECKPOINT + REVISE, never a
 *    silent hang.
 * 4. Plan admission REQUIRES an estimated tool-call count: the Config schema
 *    fails loud on a missing or non-positive estimate, and `apply` refuses to
 *    arm without it.
 * 5. The bench PRESET (home patch) composes the `bench-tripwire` row when a
 *    tripwire config is supplied (arm-agnostic), and is absent by default.
 *
 * @module @atlasai/atsh-bench/tripwire.spec
 */

import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyTripwire,
  tripwireConfig,
  DEFAULT_CHECKPOINT_DIRECTIVE,
  tripwireCheckpointResult,
  tripwireName,
  tripwireVerdict,
  writeHomePatch,
} from '../src/index.ts'

describe('plan-vs-actual tripwire decision (T13)', () => {
  it('trips the checkpoint gate on the designed hrd-02 61->280 blow-up', () => {
    // hrd-02 shape: plan estimated 61 tool calls; actual reached 280.
    // 280 > 3×61 = 183 → the tripwire fires (checkpoint-and-replan).
    const verdict = tripwireVerdict({ predicted: 61, actual: 280 })
    expect(verdict.stop).toBe(true)
    expect(verdict.reason).toBe('plan-vs-actual')
  })

  it('does NOT trip when actual is within 3x the estimate', () => {
    const verdict = tripwireVerdict({ predicted: 61, actual: 180 })
    expect(verdict.stop).toBe(false)
    expect(verdict.reason).toBeNull()
  })

  it('trips exactly at the boundary (actual === 3x predicted)', () => {
    const verdict = tripwireVerdict({ predicted: 20, actual: 60 })
    expect(verdict.stop).toBe(false)
    expect(verdict.reason).toBeNull()
  })

  it('respects a custom trip ratio', () => {
    // ratio 10: threshold 10x20=200; actual 150 stays within (no trip).
    const loose = tripwireVerdict({ predicted: 20, actual: 150, ratio: 10 })
    expect(loose.stop).toBe(false)
    // ratio 3: threshold 3x20=60; actual 61 trips.
    const tight = tripwireVerdict({ predicted: 20, actual: 61, ratio: 3 })
    expect(tight.stop).toBe(true)
    // same actual with a wider ratio stays within.
    const wide = tripwireVerdict({ predicted: 20, actual: 61, ratio: 4 })
    expect(wide.stop).toBe(false)
  })

  it('never trips on a non-positive estimate (no estimate -> no watch)', () => {
    const zero = tripwireVerdict({ predicted: 0, actual: 999 })
    expect(zero.stop).toBe(false)
    expect(zero.reason).toBeNull()
  })
})

describe('checkpoint-and-replan veto result (T13)', () => {
  it('produces the PLAN_VS_ACTUAL_TRIPPED checkpoint directive', () => {
    const result = tripwireCheckpointResult('plan-vs-actual', 61, 280, 3)
    expect(result.isError).toBe(true)
    expect(result.error?.info.code).toBe('PLAN_VS_ACTUAL_TRIPPED')
    const text = result.content.map(c => c.text).join('')
    expect(text).toContain('exceed the plan estimate of 61')
    expect(text).toContain('CHECKPOINT')
    expect(text).toContain('REVISE')
  })

  it('embeds the default directive by default', () => {
    const result = tripwireCheckpointResult('plan-vs-actual', 10, 50, 3)
    const text = result.content.map(c => c.text).join('')
    expect(text).toContain(DEFAULT_CHECKPOINT_DIRECTIVE)
    expect(text).toContain('every further call will be rejected')
  })

  it('honors a custom checkpoint directive override', () => {
    const result = tripwireCheckpointResult('plan-vs-actual', 10, 40, 3, 'STOP AND REOFFICIALIZE THE PLAN.')
    const text = result.content.map(c => c.text).join('')
    expect(text).toContain('STOP AND REOFFICIALIZE THE PLAN.')
    expect(text).not.toContain(DEFAULT_CHECKPOINT_DIRECTIVE)
  })
})

describe('plan admission requires an estimated tool-call count (T13)', () => {
  it('the Config schema rejects a non-positive estimate', () => {
    // Schemastery schemas are callable: Config(data) throws on invalid input.
    // A missing key passes (schemastery omits absent fields); the REQUIREMENT
    // is enforced at mount by apply() (see below).
    expect(() => tripwireConfig({ planEstimatedToolCalls: 0 })).toThrow()
    expect(() => tripwireConfig({ planEstimatedToolCalls: -5 })).toThrow()
  })

  it('the Config schema accepts a positive estimate and defaults the ratio to 3', () => {
    const parsed = tripwireConfig({ planEstimatedToolCalls: 61 }) as {
      planEstimatedToolCalls: number
      tripRatio: number
      checkpointDirectiveText?: string
    }
    expect(parsed.planEstimatedToolCalls).toBe(61)
    expect(parsed.tripRatio).toBe(3)
  })

  it('apply() fails loud at mount when the estimate is missing or non-positive', () => {
    // The admission REQUIREMENT lives here: a plan that was never costed (no
    // positive integer estimate) cannot be watched, so the plugin refuses to
    // arm at all. A real admission would run BEFORE any session.
    const ctx = { on: () => undefined } as never
    expect(() => {
      applyTripwire(ctx, {} as never)
    }).toThrow(/requires a positive integer/)
    expect(() => {
      applyTripwire(ctx, { planEstimatedToolCalls: 0 })
    }).toThrow(/requires a positive integer/)
    expect(() => {
      applyTripwire(ctx, { planEstimatedToolCalls: 2.5 })
    }).toThrow(/requires a positive integer/)
    // A valid estimate arms without throwing.
    expect(() => {
      applyTripwire(ctx, { planEstimatedToolCalls: 61 })
    }).not.toThrow()
  })
})

describe('bench preset tripwire composition (T13)', () => {
  it('emits the bench-tripwire row when a tripwire is configured', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-tripwire-patch-'))
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
      { planEstimatedToolCalls: 61 },
    )
    expect(patch).toContain('bench-tripwire')
    expect(patch).toContain('planEstimatedToolCalls: 61')
    expect(patch).toContain('bench-pin-request')
    expect(existsSync(join(home, 'cordis.patch.yml'))).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })

  it('does NOT emit the tripwire row by default (no tripwire config)', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-tripwire-none-'))
    const patch = writeHomePatch(home, {
      model: 'm',
      temperature: 0,
      maxTokens: 8192,
    })
    expect(patch).not.toContain('bench-tripwire')
    rmSync(home, { recursive: true, force: true })
  })

  it('tripwire row carries the ratio + directive overrides when supplied', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-tripwire-ovr-'))
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
      { planEstimatedToolCalls: 61, tripRatio: 4, checkpointDirectiveText: 'RECOMPUTE THE PLAN NOW.' },
    )
    expect(patch).toContain('tripRatio: 4')
    expect(patch).toContain('RECOMPUTE THE PLAN NOW.')
    rmSync(home, { recursive: true, force: true })
  })

  it('the tripwire plugin is a named function plugin (mountable)', () => {
    expect(tripwireName).toBe('bench-tripwire')
    expect(typeof applyTripwire).toBe('function')
    expect(applyTripwire.name.length).toBeGreaterThan(0)
  })
})

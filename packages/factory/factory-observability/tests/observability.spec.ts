/**
 * Unit coverage for @atlasai/atsh-factory-observability: the Fix 3/6/7
 * event stream with predictive failure signals (P-Ratio, Plan-Explore-Plan
 * spirals, E→V deficit, repeated identical calls), the deterministic
 * completion verifier validated on negative fixtures (TNR gate), and the
 * replay-with-patch debugging substrate. All tests are deterministic and
 * make zero model calls.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ObservabilityService, { stageOfKind, type ObsEvent, type SignalReport } from '../src/index.ts'
import { EVENT_STREAMS } from './fixtures/event-streams.ts'
import { VERIFIER_FIXTURES } from './fixtures/verifier-fixtures.ts'

/** Deep-freeze an object graph (golden-rule test helper). */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

describe('dsh-factory-observability', () => {
  let ctx: Context

  afterEach(async () => {
    await ctx?.fiber.dispose()
  })

  it('P-Ratio alarm on plan-heavy stream', async () => {
    ctx = new Context()
    await ctx.plugin(ObservabilityService, {})
    for (const event of EVENT_STREAMS.planHeavy) ctx.observability.record(event)
    const report = ctx.observability.report()
    const signal = report.signals.find(signal => signal.id === 'high-p-ratio')
    expect(signal).toBeDefined()
    expect(signal?.severity).toBe('alarm')
    expect(report.metrics.pRatio).toBeCloseTo(8 / 12)
    expect(report.verdict).toBe('ALARM')
  })

  it('E→V deficit warn on verify-light stream', async () => {
    ctx = new Context()
    await ctx.plugin(ObservabilityService, {})
    for (const event of EVENT_STREAMS.evDeficit) ctx.observability.record(event)
    const report = ctx.observability.report()
    const signal = report.signals.find(signal => signal.id === 'e-to-v-deficit')
    expect(signal).toBeDefined()
    expect(signal?.severity).toBe('warn')
    expect(report.metrics.eToV).toBeCloseTo(1 / 11)
    expect(report.verdict).toBe('WARN')
  })

  it('P-X-P spiral alarm', async () => {
    ctx = new Context()
    await ctx.plugin(ObservabilityService, {})
    for (const event of EVENT_STREAMS.pxpSpiral) ctx.observability.record(event)
    const report = ctx.observability.report()
    expect(report.metrics.pxpSpirals).toBe(2)
    const signal = report.signals.find(signal => signal.id === 'plan-explore-plan-spiral')
    expect(signal).toBeDefined()
    expect(signal?.severity).toBe('alarm')
    expect(report.verdict).toBe('ALARM')
  })

  it('repeated-call alarm', async () => {
    ctx = new Context()
    await ctx.plugin(ObservabilityService, {})
    for (const event of EVENT_STREAMS.repeatedCalls) ctx.observability.record(event)
    const report = ctx.observability.report()
    expect(report.metrics.maxRepeatRun).toBe(4)
    const signal = report.signals.find(signal => signal.id === 'repeated-identical-calls')
    expect(signal).toBeDefined()
    expect(signal?.severity).toBe('alarm')
  })

  it('healthy stream is CLEAR', async () => {
    ctx = new Context()
    await ctx.plugin(ObservabilityService, {})
    for (const event of EVENT_STREAMS.healthy) ctx.observability.record(event)
    const report = ctx.observability.report()
    expect(report.verdict).toBe('CLEAR')
    expect(report.signals).toEqual([])
    expect(report.metrics.totalEvents).toBe(14)
    expect(report.metrics.pRatio).toBeCloseTo(2 / 14)
    expect(report.metrics.eToV).toBeCloseTo(3 / 7)
    expect(report.metrics.pxpSpirals).toBe(0)
    expect(report.metrics.maxRepeatRun).toBe(1)
  })

  it('stageOfKind maps known kinds, null otherwise', () => {
    expect(stageOfKind('judge/ballot')).toBe('evaluate')
    expect(stageOfKind('judge/verdict')).toBe('verify')
    expect(stageOfKind('judge/replan')).toBe('plan')
    expect(stageOfKind('budget/route')).toBe('explore')
    expect(stageOfKind('budget/veto')).toBe('evaluate')
    expect(stageOfKind('lane/veto')).toBe('evaluate')
    expect(stageOfKind('factory/contract-registered')).toBe('plan')
    expect(stageOfKind('unknown/thing')).toBeNull()
  })

  it('self-declared completion rejected', async () => {
    ctx = new Context()
    await ctx.plugin(ObservabilityService, {})
    const neg = VERIFIER_FIXTURES.find(fixture => fixture.id === 'neg-self-declared-empty')!
    const verdict = ctx.observability.verifyCompletion(neg.claim, neg.checks)
    expect(verdict.status).toBe('FAIL')
    expect(verdict.reasons).toEqual(['self-declared completion rejected'])
    const pos = VERIFIER_FIXTURES.find(fixture => fixture.id === 'pos-evidence-covers-checks')!
    const pass = ctx.observability.verifyCompletion(pos.claim, pos.checks)
    expect(pass.status).toBe('PASS')
    expect(pass.reasons).toEqual([])
  })

  it('TNR gate: negative-fixture TNR >= 0.8', async () => {
    ctx = new Context()
    await ctx.plugin(ObservabilityService, {})
    const stats = ctx.observability.validateVerifier(VERIFIER_FIXTURES)
    // The exact 1.0 falls out of the deterministic verifier; the gate is the
    // assertion below: negatives MUST be rejected at >= 0.8 or the verifier
    // certifies garbage (LLM judges run TNR < 25% vs TPR > 96%).
    expect(stats.tnr).toBe(1)
    expect(stats.tpr).toBe(1)
    expect(stats.positives).toBe(6)
    expect(stats.negatives).toBe(6)
    expect(stats.tnr).toBeGreaterThanOrEqual(0.8)
    expect(stats.tpr).toBeGreaterThanOrEqual(0.8)
  })

  it('replay-with-patch attributes the spiral', async () => {
    ctx = new Context()
    await ctx.plugin(ObservabilityService, {})
    for (const event of EVENT_STREAMS.pxpSpiral) ctx.observability.record(event)
    const beforeJson = JSON.stringify(ctx.observability.stream())
    // Index 4 is the 'explore' of trigram 2 (indices 3-5); patching it to
    // 'evaluate' breaks trigram 2, leaving only trigram 1 (indices 0-2).
    const result = ctx.observability.signalAt(4, { ts: 4, stage: 'evaluate', kind: 'judge/ballot', detail: 'patched' })
    expect(result.before.metrics.pxpSpirals).toBe(2)
    expect(result.after.metrics.pxpSpirals).toBe(1)
    expect(result.changed).toContain('plan-explore-plan-spiral')
    // Golden rule: the recorded stream is byte-identical after the replay.
    expect(JSON.stringify(ctx.observability.stream())).toBe(beforeJson)
  })

  it('replay patch out of bounds throws', async () => {
    ctx = new Context()
    await ctx.plugin(ObservabilityService, {})
    for (const event of EVENT_STREAMS.healthy) ctx.observability.record(event)
    expect(() => ctx.observability.signalAt(999, { ts: 999, stage: 'plan', kind: 'judge/replan' }))
      .toThrow(RangeError)
  })

  it('service emits observability/report on signal change', async () => {
    ctx = new Context()
    const reports: SignalReport[] = []
    ctx.on('observability/report', report => reports.push(report))
    await ctx.plugin(ObservabilityService, {})
    // Healthy settles CLEAR (intermediate states may emit transient
    // signals while the buffer fills — only the final state is asserted).
    for (const event of EVENT_STREAMS.healthy) ctx.observability.record(event)
    expect(ctx.observability.report().verdict).toBe('CLEAR')
    // Isolate the plan-heavy pass so its signal change is observable.
    ctx.observability.reset()
    for (const event of EVENT_STREAMS.planHeavy) ctx.observability.record(event)
    expect(reports.some(report => report.verdict === 'ALARM')).toBe(true)
    const emitted = reports.length
    // A second identical stage keeps the same signal ids → dedup, no emit.
    for (const event of EVENT_STREAMS.planHeavy) ctx.observability.record(event)
    expect(reports.length).toBe(emitted)
  })

  it('ring buffer caps at windowSize', async () => {
    ctx = new Context()
    await ctx.plugin(ObservabilityService, { windowSize: 4 })
    for (let ts = 1; ts <= 6; ts++) {
      ctx.observability.record({ ts, stage: 'plan', kind: 'judge/replan' })
    }
    const stream = ctx.observability.stream()
    expect(stream).toHaveLength(4)
    expect(stream[0]!.ts).toBe(3) // oldest event gone
    expect(stream[3]!.ts).toBe(6) // newest present
  })

  it('golden rule: inputs byte-identical + buffer not retained by reference', async () => {
    ctx = new Context()
    await ctx.plugin(ObservabilityService, {})
    // A deep-frozen event records without throwing and stays unchanged.
    const frozen: ObsEvent = { ts: 1, stage: 'plan', kind: 'judge/replan', detail: 'r1' }
    deepFreeze(frozen)
    expect(() => { ctx.observability.record(frozen) }).not.toThrow()
    expect(frozen).toEqual({ ts: 1, stage: 'plan', kind: 'judge/replan', detail: 'r1' })
    expect(Object.isFrozen(frozen)).toBe(true)
    // Mutating the ORIGINAL object after record does NOT change the buffer
    // (copy semantics — the buffer never retains inputs by reference).
    const mutable: ObsEvent = { ts: 2, stage: 'explore', kind: 'budget/route', detail: 'route-1' }
    ctx.observability.record(mutable)
    mutable.ts = 999
    mutable.detail = 'mutated'
    const buffered = ctx.observability.stream()
    expect(buffered).toHaveLength(2)
    expect(buffered[1]!.ts).toBe(2)
    expect(buffered[1]!.detail).toBe('route-1')
    expect(buffered[0]).toEqual(frozen)
  })

  it('disabled config is passive', async () => {
    ctx = new Context()
    await ctx.plugin(ObservabilityService, { enabled: false })
    expect(() => { ctx.observability.record({ ts: 1, stage: 'plan', kind: 'judge/replan' }) })
      .toThrow('observability disabled')
    expect(() => { ctx.observability.report() }).toThrow('observability disabled')
    expect(() => { ctx.observability.signalAt(0, { ts: 1, stage: 'plan', kind: 'judge/replan' }) })
      .toThrow('observability disabled')
    expect(() => { ctx.observability.reset() }).toThrow('observability disabled')
    // The verifier is a pure filter — always available, even when disabled.
    const verdict = ctx.observability.verifyCompletion(
      { taskId: 't1', summary: 'done', evidence: ['implemented login()'], selfDeclared: false },
      [{ id: 'login', clause: 'login' }],
    )
    expect(verdict.status).toBe('PASS')
    const stats = ctx.observability.validateVerifier(VERIFIER_FIXTURES)
    expect(stats.tnr).toBe(1)
    expect(stats.tpr).toBe(1)
  })

  it('service subscribes to harness events by kind', async () => {
    ctx = new Context()
    await ctx.plugin(ObservabilityService, {})
    ctx.emit('judge/ballot', {
      role: 'decomposition',
      judgmentId: 'j1',
      planId: 'p1',
      kind: 'plan',
      vote: 'YES',
      reasons: [],
    })
    ctx.emit('budget/veto', { account: 'a1', spend: 10, budget: 5, stage: 'general', ts: 2 })
    const report = ctx.observability.report()
    expect(report.metrics.totalEvents).toBe(2)
    // evaluate 2, verify 0 → eToV 0; no throw.
    expect(report.metrics.eToV).toBe(0)
    // Detail extraction: the budget/veto account surfaces as the detail.
    expect(ctx.observability.stream()[1]!.detail).toBe('a1')
  })
})

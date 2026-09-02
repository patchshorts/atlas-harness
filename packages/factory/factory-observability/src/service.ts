// ObservabilityService: the ctx.observability capability.
//
// Fix 3/6/7 observability + verifier correctness — every step is logged as a
// structured event; the append-only event stream is the source of truth.
// Predictive failure signals (P-Ratio, Plan-Explore-Plan spirals, E→V
// deficit, repeated identical calls) are derived over the stream, completion
// is owned by the deterministic verifier (validated on negative fixtures —
// the TNR gate), and replay-with-patch is the debugging substrate. Golden
// rule: the in-memory ring buffer is a DERIVED projection — this package
// never writes to the session log or message history; events are copied into
// the buffer by value and every pass produces NEW values.

import { Context, Service } from '@deepseek-ai/cordis'
import type { Events } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { computeMetrics } from './metrics.ts'
import { composeReport } from './signals.ts'
import type { SignalThresholds } from './signals.ts'
import { replayWithPatch } from './replay.ts'
import { stageOfKind } from './stages.ts'
import { validateVerifier as runValidateVerifier, verifyCompletion as runVerifyCompletion } from './verifier.ts'
import type {
  CompletionCheck,
  CompletionClaim,
  CompletionVerdict,
  ObsEvent,
  ObservabilityConfig,
  ReplayResult,
  SignalReport,
  VerifierFixture,
  VerifierStats,
} from './types.ts'

const SUPPORTED_CONFIG_KEYS = new Set(['enabled', 'windowSize', 'pRatioAlarm', 'evDeficitWarn', 'repeatThreshold'])

/** Reject stale or misspelled config keys before defaults can hide them. */
function validateConfigKeys(config: ObservabilityConfig): void {
  for (const key of Object.keys(config)) {
    if (!SUPPORTED_CONFIG_KEYS.has(key)) {
      throw new Error(`ObservabilityConfig: unknown key "${key}"`)
    }
  }
}

/** The harness event kinds this service subscribes to (see src/stages.ts). */
const KNOWN_KINDS = [
  'judge/ballot',
  'judge/verdict',
  'judge/replan',
  'budget/route',
  'budget/veto',
  'lane/veto',
  'factory/contract-registered',
]

/**
 * The Fix 3/6/7 observability seam: an in-memory append-only ring buffer of
 * structured events, predictive failure signals over the stream, the
 * deterministic completion verifier (TNR gate), and the replay-with-patch
 * debugging substrate. The buffer is a derived projection — the session log
 * and message history are never touched (golden rule). The verifier methods
 * are pure filters and stay available even when the service is disabled.
 */
export class ObservabilityService extends Service {
  static Config = z.object({
    enabled: z.boolean().default(true),
    windowSize: z.number().default(512),
    pRatioAlarm: z.number().default(0.5),
    evDeficitWarn: z.number().default(0.1),
    repeatThreshold: z.number().default(3),
  })

  private readonly enabled: boolean
  private readonly windowSize: number
  private readonly pRatioAlarm: number
  private readonly evDeficitWarn: number
  private readonly repeatThreshold: number
  private readonly events: ObsEvent[] = []
  private lastSignalIds: string[] = []

  constructor(ctx: Context, config: ObservabilityConfig) {
    super(ctx, 'observability')
    validateConfigKeys(config)
    this.enabled = config.enabled ?? true
    this.windowSize = config.windowSize ?? 512
    this.pRatioAlarm = config.pRatioAlarm ?? 0.5
    this.evDeficitWarn = config.evDeficitWarn ?? 0.1
    this.repeatThreshold = config.repeatThreshold ?? 3
    if (this.enabled) {
      for (const kind of KNOWN_KINDS) {
        const stage = stageOfKind(kind)
        if (stage !== null) {
          ctx.on(kind as keyof Events, (payload: unknown) => {
            const detail = this.detailOf(kind, payload)
            this.record(detail === undefined
              ? { ts: Date.now(), stage, kind }
              : { ts: Date.now(), stage, kind, detail })
          })
        }
      }
    }
    ctx.effect(() => () => {}, 'factory-observability: in-memory ring buffer owns no external resources')
  }

  private get thresholds(): SignalThresholds {
    return {
      pRatioAlarm: this.pRatioAlarm,
      evDeficitWarn: this.evDeficitWarn,
      repeatThreshold: this.repeatThreshold,
    }
  }

  /**
   * Extract a short detail string from an event payload when it carries one.
   *
   * @param _kind - the source event kind (kept for listener symmetry).
   * @param payload - the raw event payload.
   * @returns the first present `account`/`name`/`stage`/`tool` value as a
   *   string, or undefined when the payload has none of them.
   */
  private detailOf(_kind: string, payload: unknown): string | undefined {
    if (typeof payload === 'object' && payload !== null) {
      const record = payload as Record<string, unknown>
      for (const key of ['account', 'name', 'stage', 'tool'] as const) {
        const value = record[key]
        if (value !== undefined && value !== null) {
          // Scalars stringify directly; objects fall back to JSON — never
          // Object.prototype.toString ('[object Object]').
          if (typeof value === 'string' || typeof value === 'number'
            || typeof value === 'boolean' || typeof value === 'bigint') {
            return String(value)
          }
          return JSON.stringify(value)
        }
      }
    }
    return undefined
  }

  /**
   * Append one structured event to the ring buffer (a derived projection —
   * the event object is copied, never retained by reference). When the
   * buffer exceeds `windowSize`, the oldest event is dropped. Emits
   * `observability/report` with the current report ONLY when the signal ids
   * changed since the last emission.
   *
   * @param event - the structured event to append.
   * @throws {Error} When the service is disabled.
   * @emits observability/report
   */
  record(event: ObsEvent): void {
    if (!this.enabled) {
      throw new Error('observability disabled')
    }
    this.events.push({ ...event })
    if (this.events.length > this.windowSize) {
      this.events.shift()
    }
    const report = this.report()
    const ids = report.signals.map(signal => signal.id)
    const changed = ids.length !== this.lastSignalIds.length
      || ids.some((id, index) => id !== this.lastSignalIds[index])
    if (changed) {
      this.lastSignalIds = ids
      this.ctx.emit('observability/report', report)
    }
  }

  /**
   * The current signal report over the buffered events.
   *
   * @returns the composed report: metrics, firing signals, and the verdict.
   * @throws {Error} When the service is disabled.
   */
  report(): SignalReport {
    if (!this.enabled) {
      throw new Error('observability disabled')
    }
    return composeReport(computeMetrics(this.events), this.thresholds)
  }

  /**
   * Replay the buffered stream with one event patched, attributing signal
   * changes to the patch — the debugging substrate: the error's surfacing
   * step is not necessarily the cause step.
   *
   * @param index - the event index in the buffered stream to replace.
   * @param event - the replacement event (the "patch").
   * @returns the before/after reports and the signal ids that changed.
   * @throws {Error} When the service is disabled.
   * @throws {RangeError} When `index` is out of bounds.
   */
  signalAt(index: number, event: ObsEvent): ReplayResult {
    if (!this.enabled) {
      throw new Error('observability disabled')
    }
    return replayWithPatch(this.events, { index, event }, this.thresholds)
  }

  /**
   * Verify a completion claim against the checks. Completion is owned by
   * the verifier — a self-declared completion without evidence is rejected.
   * Works when disabled (the verifier is a pure filter, always available).
   *
   * @param claim - the completion claim (summary, evidence, selfDeclared).
   * @param checks - the checks the evidence must satisfy.
   * @returns the verdict: PASS with empty reasons, or FAIL with every
   *   unsatisfied check cited.
   */
  verifyCompletion(claim: CompletionClaim, checks: CompletionCheck[]): CompletionVerdict {
    return runVerifyCompletion(claim, checks)
  }

  /**
   * Validate the verifier against fixtures, reporting TPR/TNR — the TNR
   * gate: a verifier that accepts negative fixtures certifies garbage.
   * Works when disabled.
   *
   * @param fixtures - the positive and negative fixtures with expected
   *   verdicts.
   * @returns the verifier stats (tpr, tnr, positives, negatives).
   */
  validateVerifier(fixtures: VerifierFixture[]): VerifierStats {
    return runValidateVerifier(runVerifyCompletion, fixtures)
  }

  /**
   * A read-only view of the ring buffer. Callers must not mutate the
   * returned array — the golden-rule tests assert the buffer never changes
   * externally.
   *
   * @returns the buffered events.
   */
  stream(): readonly ObsEvent[] {
    return this.events
  }

  /**
   * Clear the ring buffer and the last-emitted signal ids.
   *
   * @throws {Error} When the service is disabled.
   */
  reset(): void {
    if (!this.enabled) {
      throw new Error('observability disabled')
    }
    this.events.length = 0
    this.lastSignalIds = []
  }
}

export default ObservabilityService

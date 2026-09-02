// JudgeService: the ctx.factoryJudge capability.
//
// Pass 4 unanimous three-panel judge — pre-commit gate for plans, failure
// triage, and completion verdicts. Fresh context per judge: ballots are
// computed independently from the request + the role charter only, and the
// service shares NO ballot state between roles. Golden rule: the judge never
// touches session log, message history, or projections — it operates on plan
// artifacts only.

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { decompositionVote, feasibilityVote, verifiableVote } from './rules.ts'
import type {
  JudgeConfig,
  JudgeKind,
  JudgeReplanState,
  JudgeRequest,
  JudgeVerdict,
} from './types.ts'

/** Local guard: value is a string, non-empty, and already trimmed. */
function normalizedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

const SUPPORTED_CONFIG_KEYS = new Set(['enabled', 'maxReplans', 'replanCost'])

/** Reject stale or misspelled config keys before defaults can hide them. */
function validateConfigKeys(config: JudgeConfig): void {
  for (const key of Object.keys(config)) {
    if (!SUPPORTED_CONFIG_KEYS.has(key)) {
      throw new Error(`JudgeConfig: unknown key "${key}"`)
    }
  }
}

const KINDS: readonly JudgeKind[] = ['plan', 'triage', 'completion']

/** Shape of the optional accounting service (loaded via ctx.get, never ctx.accounting). */
interface AccountingLike {
  charge(account: string, amount: number, reason: string, meta: Record<string, unknown>): void
}

/**
 * The Pass 4 judge seam: unanimous three-panel verdicts with a bounded replan
 * loop, votes in the event stream, and replan cost charged to accounting.
 *
 * Fresh-context guarantee: ballots are computed independently from the request
 * + the role charter only; the service shares NO ballot state between roles.
 * Golden rule: the judge never touches session log, message history, or
 * projections — it operates on plan artifacts only.
 */
export class JudgeService extends Service {
  static Config = z.object({
    enabled: z.boolean().default(true),
    maxReplans: z.number().default(3),
    replanCost: z.number().default(1500),
  })

  private readonly enabled: boolean
  private readonly maxReplans: number
  private readonly replanCost: number
  private readonly replan = new Map<string, number>()
  private readonly approvals = new Map<string, string>()

  constructor(ctx: Context, config: JudgeConfig) {
    super(ctx, 'factoryJudge')
    validateConfigKeys(config)
    this.enabled = config.enabled ?? true
    this.maxReplans = config.maxReplans ?? 3
    this.replanCost = config.replanCost ?? 1500
    ctx.effect(() => () => {}, 'factory-judge: in-memory ballot and replan state owns no external resources')
  }

  /**
   * Judge one request: compute the ballots (single → decomposition only;
   * panel → decomposition + feasibility + verification), emit each ballot,
   * and settle the verdict — PASS when every ballot is YES; REPLAN when any
   * NO and replan budget remains (charge replanCost to accounting, emit
   * judge/replan); ESCALATE when any NO and the budget is exhausted (no new
   * charge). A plan PASS records the approval; PASS and ESCALATE clear the
   * judgment's replan entry. Emits judge/verdict last.
   *
   * @param request - the judgment request; mode defaults 'panel' and account
   *   defaults 'default'.
   * @returns the settled verdict with every ballot and the replan budget.
   * @throws {Error} When the service is disabled.
   * @throws {TypeError} When the request is malformed: a non-empty normalized
   *   judgmentId/planId/revision is required, kind must be valid, 'plan'
   *   requests require a non-empty tasks array, 'completion' requests require
   *   a submission, and 'triage' requests require a triage.
   * @emits judge/ballot, judge/replan, judge/verdict
   */
  judge(request: JudgeRequest): JudgeVerdict {
    if (!this.enabled) {
      throw new Error('factory-judge disabled')
    }
    if (!normalizedText(request.judgmentId)) {
      throw new TypeError('factory-judge: judgmentId must be a non-empty normalized string')
    }
    if (!normalizedText(request.planId)) {
      throw new TypeError('factory-judge: planId must be a non-empty normalized string')
    }
    if (!normalizedText(request.revision)) {
      throw new TypeError('factory-judge: revision must be a non-empty normalized string')
    }
    if (!KINDS.includes(request.kind)) {
      throw new TypeError(`factory-judge: unknown judge kind "${request.kind}"`)
    }
    if (request.kind === 'plan' && (!Array.isArray(request.tasks) || request.tasks.length === 0)) {
      throw new TypeError('factory-judge: plan judgments require a non-empty tasks array')
    }
    if (request.kind === 'completion' && !request.submission) {
      throw new TypeError('factory-judge: completion judgments require a submission')
    }
    if (request.kind === 'triage' && !request.triage) {
      throw new TypeError('factory-judge: triage judgments require a triage')
    }

    const mode = request.mode ?? 'panel'
    const account = request.account ?? 'default'
    const approved = this.isPlanApproved(request.planId, request.revision)
    const ballots = mode === 'single'
      ? [decompositionVote(request)]
      : [decompositionVote(request), feasibilityVote(request), verifiableVote(request, approved)]
    for (const vote of ballots) {
      this.ctx.emit('judge/ballot', vote)
    }

    const used = this.replan.get(request.judgmentId) ?? 0
    const round = used + 1
    const anyNo = ballots.some(vote => vote.vote === 'NO')
    let verdictKind: JudgeVerdict['verdict']
    let replansUsed = used
    let replanCostCharged = 0

    if (!anyNo) {
      verdictKind = 'PASS'
      if (request.kind === 'plan') {
        this.approvals.set(request.planId, request.revision)
      }
      this.replan.delete(request.judgmentId)
    } else if (used < this.maxReplans) {
      verdictKind = 'REPLAN'
      this.replan.set(request.judgmentId, used + 1)
      replansUsed = used + 1
      replanCostCharged = this.replanCost
      const accounting = this.ctx.get('accounting') as AccountingLike | undefined
      accounting?.charge(account, this.replanCost, 'judge-replan', {
        judgmentId: request.judgmentId,
        planId: request.planId,
        kind: request.kind,
        round,
      })
      this.ctx.emit('judge/replan', {
        judgmentId: request.judgmentId,
        planId: request.planId,
        kind: request.kind,
        round,
        cost: this.replanCost,
      })
    } else {
      verdictKind = 'ESCALATE'
      this.replan.delete(request.judgmentId)
    }

    const verdict: JudgeVerdict = {
      judgmentId: request.judgmentId,
      planId: request.planId,
      revision: request.revision,
      kind: request.kind,
      mode,
      verdict: verdictKind,
      round,
      ballots,
      replansUsed,
      replansRemaining: this.maxReplans - replansUsed,
      replanCostCharged,
    }
    this.ctx.emit('judge/verdict', verdict)
    return verdict
  }

  /**
   * Whether a plan revision was approved by a panel PASS.
   *
   * @param planId - the plan id.
   * @param revision - when given, the approval must match this revision
   *   exactly; when omitted, any recorded approval counts.
   * @returns true when the plan (revision) was approved.
   */
  isPlanApproved(planId: string, revision?: string): boolean {
    const approved = this.approvals.get(planId)
    return revision === undefined ? approved !== undefined : approved === revision
  }

  /**
   * Read the replan budget for one judgment.
   *
   * @param judgmentId - the judgment id.
   * @returns the replans used and the configured maximum (0 for an unknown
   *   judgment id).
   */
  replanState(judgmentId: string): JudgeReplanState {
    return { replansUsed: this.replan.get(judgmentId) ?? 0, maxReplans: this.maxReplans }
  }

  /**
   * Reset a judgment's replan budget. Approvals persist.
   *
   * @param judgmentId - the judgment id to clear.
   */
  resetJudgment(judgmentId: string): void {
    this.replan.delete(judgmentId)
  }
}

export default JudgeService

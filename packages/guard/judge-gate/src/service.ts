// JudgeGateService: the ctx.judgeGate seam — enforces the Pass 4 unanimous
// three-panel judge at the three SAD moments: plan admission, task
// completion, and exit review.
//
// Fail-closed: a NOT PASS verdict throws JudgeGateError carrying the verdict
// and every NO reason, so the caller (plan-mode admission, the factory loop)
// can hand the model exact artifact-citing reasons to revise with. The panel
// itself lives in @atlasai/atsh-factory-judge (ctx.factoryJudge, sibling
// the prior workstream deliverable, read-only) — this service only parses plan artifacts
// and calls it. The gate adds no events: ballots, replans, and verdicts ride
// the existing judge/* stream. Golden rule: the gate never touches session
// log, message history, or projections — plan artifacts only.
//
// D2: the replan budget (N≤2, Config.maxReplans default 2) is enforced by a
// pre-invocation check against the panel's own replan counter (the panel's
// default budget is 3; the gate is the SAD's N≤2 authority for its moments).

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { JudgePlanTask, JudgeRequest, JudgeService, JudgeVerdict } from '@atlasai/atsh-factory-judge'
import { parsePlanTasks } from './parser.ts'
import type {
  JudgeGateAdmissionInput,
  JudgeGateCompletionInput,
  JudgeGateConfig,
  JudgeGateError as JudgeGateErrorShape,
} from './types.ts'

const SUPPORTED_CONFIG_KEYS = new Set(['enabled', 'maxReplans', 'requirePlanApproval'])

/** Reject stale or misspelled config keys before defaults can hide them. */
function validateConfigKeys(config: JudgeGateConfig): void {
  for (const key of Object.keys(config)) {
    if (!SUPPORTED_CONFIG_KEYS.has(key)) {
      throw new Error(`JudgeGateConfig: unknown key "${key}"`)
    }
  }
}

/**
 * The error thrown when the gate rejects (fail-closed). Carries the verdict
 * and every NO reason across the round's ballots, plus the parsed tasks, so
 * the model revises with exact artifact-citing feedback.
 */
export class JudgeGateError extends Error implements JudgeGateErrorShape {
  override readonly name = 'JudgeGateError' as const
  readonly verdict: JudgeVerdict
  readonly tasks: JudgePlanTask[]
  readonly reasons: string[]

  constructor(message: string, verdict: JudgeVerdict, tasks: JudgePlanTask[], reasons: string[]) {
    super(message)
    this.verdict = verdict
    this.tasks = tasks
    this.reasons = reasons
  }
}

/** A gate judgment kind: the two surfaces the gate enforces. */
type GateKind = 'plan' | 'completion'

/**
 * The Pass 4 judge gate: enforces the three-panel panel at the three SAD
 * moments. Resolves the panel via ctx.get('factoryJudge') at INVOCATION time
 * (never at load), so compositions without the factory packages still boot;
 * invoking the gate without the panel fails closed with a clear error.
 */
export class JudgeGateService extends Service {
  static Config = z.object({
    enabled: z.boolean().default(true),
    maxReplans: z.number().default(2), // D2: N≤2
    requirePlanApproval: z.boolean().default(true),
  })

  private readonly enabled: boolean
  private readonly maxReplans: number
  private readonly requirePlanApproval: boolean

  /** Admitted plans: planId → admitted revision + parsed tasks. */
  private readonly admitted = new Map<string, { revision: string; tasks: JudgePlanTask[] }>()

  constructor(ctx: Context, config: JudgeGateConfig) {
    super(ctx, 'judgeGate')
    validateConfigKeys(config)
    this.enabled = config.enabled ?? true
    this.maxReplans = config.maxReplans ?? 2
    this.requirePlanApproval = config.requirePlanApproval ?? true
    ctx.effect(() => () => {}, 'judge-gate: in-memory admission registry owns no external resources')
  }

  /**
   * Gate the plan admission moment: parse the presented plan, run the panel
   * (kind 'plan'), and fail closed unless every ballot is YES. A PASS records
   * the approval (panel-side) and admits the plan for completion/exit votes.
   *
   * @param input - the presented plan: plan id, revision (presentation
   *   ordinal — a re-present after a NO bumps it), and the plan markdown.
   * @returns the settled PASS verdict.
   * @throws {JudgeGateError} When the plan does not pass (REPLAN/ESCALATE),
   *   when it has no parseable task rows, or when the panel is missing.
   * @throws {Error} When the gate is disabled.
   */
  admitPlan(input: JudgeGateAdmissionInput): JudgeVerdict {
    const tasks = parsePlanTasks(input.planMarkdown)
    if (tasks.length === 0) {
      // Nothing for the panel to judge: fail closed with the canonical
      // reason instead of letting the panel's plan-kind TypeError leak.
      throw new JudgeGateError(
        `judge-gate: plan ${input.planId}@${input.revision} has no parseable task rows`,
        this.syntheticVerdict(`${input.planId}:plan`, input.planId, input.revision, 'plan', 'REPLAN', 0),
        tasks,
        ['plan has no tasks'],
      )
    }
    const verdict = this.judgeOrThrow('plan', input, { tasks })
    this.admitted.set(input.planId, { revision: input.revision, tasks })
    return verdict
  }

  /**
   * Gate the task completion moment: run the panel with kind 'completion'
   * against the ADMITTED plan's tasks. Fail closed when the plan was never
   * admitted or the claim is not evidence-backed.
   *
   * @param input - the admitted plan id + revision and the claimed submission.
   * @returns the settled PASS verdict.
   * @throws {JudgeGateError} On NOT PASS, on an unknown or mismatched
   *   admission, or when the panel is missing.
   * @throws {Error} When the gate is disabled.
   */
  checkCompletion(input: JudgeGateCompletionInput): JudgeVerdict {
    return this.completionVerdict(input)
  }

  /**
   * Gate the exit review moment: the final completion verdict over the
   * admitted plan. Same verification contract as checkCompletion.
   *
   * @param input - the admitted plan id + revision and the claimed submission.
   * @returns the settled PASS verdict.
   * @throws {JudgeGateError} On NOT PASS, on an unknown or mismatched
   *   admission, or when the panel is missing.
   * @throws {Error} When the gate is disabled.
   */
  reviewExit(input: JudgeGateCompletionInput): JudgeVerdict {
    return this.completionVerdict(input)
  }

  /** The shared completion/exit enforcement. */
  private completionVerdict(input: JudgeGateCompletionInput): JudgeVerdict {
    const admitted = this.admitted.get(input.planId)
    if (this.requirePlanApproval) {
      if (admitted === undefined) {
        throw new JudgeGateError(
          `judge-gate: plan ${input.planId} was never admitted; completion cannot be judged`,
          this.syntheticVerdict(`${input.planId}:completion`, input.planId, input.revision, 'completion', 'REPLAN', 0),
          [],
          ['plan artifact not admitted by the panel'],
        )
      }
      if (admitted.revision !== input.revision) {
        throw new JudgeGateError(
          `judge-gate: plan ${input.planId} admitted at revision ${admitted.revision}, not ${input.revision}`,
          this.syntheticVerdict(`${input.planId}:completion`, input.planId, input.revision, 'completion', 'REPLAN', 0),
          admitted.tasks,
          [`plan artifact not approved at revision ${input.revision}`],
        )
      }
    }
    const tasks = admitted?.tasks ?? []
    return this.judgeOrThrow('completion', input, { tasks, submission: input.submission })
  }

  /**
   * Resolve the panel at invocation time and run one judgment round,
   * enforcing the gate's own replan bound (D2 N≤2) before invoking so a
   * further re-presentation cannot be judged once the budget is spent.
   */
  private judgeOrThrow(
    kind: GateKind,
    input: { planId: string; revision: string },
    request: Omit<JudgeRequest, 'judgmentId' | 'planId' | 'revision' | 'kind'>,
  ): JudgeVerdict {
    const judge = this.resolveJudge()
    const judgmentId = `${input.planId}:${kind}`
    const budget = judge.replanState(judgmentId)
    if (budget.replansUsed >= this.maxReplans) {
      throw new JudgeGateError(
        `judge-gate: replan budget exhausted for ${judgmentId} (max ${this.maxReplans})`,
        this.syntheticVerdict(judgmentId, input.planId, input.revision, kind, 'ESCALATE', budget.replansUsed),
        request.tasks,
        [`replan budget exhausted: max ${this.maxReplans} replans per judgment`],
      )
    }
    const verdict = judge.judge({ judgmentId, planId: input.planId, revision: input.revision, kind, ...request })
    if (verdict.verdict !== 'PASS') {
      throw new JudgeGateError(
        `judge-gate: ${kind} rejected for ${input.planId}@${input.revision}: ${verdict.verdict}`,
        verdict,
        request.tasks,
        verdict.ballots.flatMap(ballot => ballot.reasons),
      )
    }
    return verdict
  }

  /**
   * The panel, resolved at invocation time. Fail closed when the panel is
   * not composed or the gate is disabled.
   */
  private resolveJudge(): JudgeService {
    if (!this.enabled) {
      throw new Error('judge-gate: gate is disabled')
    }
    const judge = this.ctx.get('factoryJudge')
    if (judge === undefined) {
      throw new Error('judge-gate: the factoryJudge panel service is not composed; the gate cannot judge')
    }
    return judge
  }

  /**
   * A minimal verdict for rejections the panel never ran (no ballot is cast
   * and none is fabricated): round 0 with an empty ballots array. Used for
   * unparseable plans, unknown admissions, and budget exhaustion.
   */
  private syntheticVerdict(
    judgmentId: string,
    planId: string,
    revision: string,
    kind: GateKind,
    verdict: 'REPLAN' | 'ESCALATE',
    replansUsed: number,
  ): JudgeVerdict {
    return {
      judgmentId,
      planId,
      revision,
      kind,
      mode: 'panel',
      verdict,
      round: 0,
      ballots: [],
      replansUsed,
      replansRemaining: Math.max(0, this.maxReplans - replansUsed),
      replanCostCharged: 0,
    }
  }
}

export default JudgeGateService

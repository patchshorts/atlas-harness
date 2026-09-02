// FactoryService: the ctx.factory capability.
//
// Plan-contract registry + deterministic BAR critic scoring for the factory
// workflow, plus planner/developer/critic role-objective builders over the
// ralph tool.

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { criticObjective, developerObjective, plannerObjective } from './roles.ts'
import type { BarSubmission, BarVerdict, ContractScore, FactoryConfig, FactoryPlanTask, PlannerInput } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    factory: FactoryService
  }
}

/** Local guard: value is a string, non-empty, and already trimmed. */
function normalizedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

/**
 * The factory seam: plan-contract registry, deterministic BAR critic scoring,
 * and immutable role objectives for the ralph tool.
 */
export class FactoryService extends Service {
  static Config = z.object({
    enabled: z.boolean().default(true),
    maxPlanTasks: z.number().default(100),
  })

  private readonly enabled: boolean
  private readonly maxPlanTasks: number
  private readonly contracts = new Map<string, FactoryPlanTask[]>()

  constructor(ctx: Context, config: FactoryConfig) {
    super(ctx, 'factory')
    this.enabled = config.enabled ?? true
    this.maxPlanTasks = config.maxPlanTasks ?? 100
    ctx.effect(() => () => {}, 'dsh-factory: in-memory contract registry owns no external resources')
  }

  /**
   * Register (or replace) the atomic-task contract for a plan id.
   *
   * @param planId - The plan id, a non-empty normalized string.
   * @param tasks - The atomic tasks, at least one, each with normalized
   *   id/verb/object/verifies fields and unique ids, at most maxPlanTasks.
   * @throws {Error} When the service is disabled.
   * @throws {TypeError} When the plan id, the task array, or any task field
   *   is invalid, ids are duplicated, or the array exceeds maxPlanTasks.
   * @emits factory/contract-registered
   */
  registerPlanContract(planId: string, tasks: FactoryPlanTask[]): void {
    if (!this.enabled) {
      throw new Error('factory disabled')
    }
    if (!normalizedText(planId)) {
      throw new TypeError('factory: planId must be a non-empty normalized string')
    }
    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new TypeError('factory: plan contract tasks must be a non-empty array')
    }
    const seen = new Set<string>()
    for (const task of tasks) {
      if (!normalizedText(task.id) || !normalizedText(task.verb) || !normalizedText(task.object) || !normalizedText(task.verifies)) {
        throw new TypeError('factory: plan contract tasks must have non-empty normalized id/verb/object/verifies')
      }
      if (seen.has(task.id)) {
        throw new TypeError(`factory: plan contract has duplicate task id "${task.id}"`)
      }
      seen.add(task.id)
    }
    if (tasks.length > this.maxPlanTasks) {
      throw new TypeError(`factory: plan contract exceeds maxPlanTasks (${tasks.length} > ${this.maxPlanTasks})`)
    }
    this.contracts.set(planId, tasks.map(task => ({ ...task })))
    this.ctx.emit('factory/contract-registered', { planId, count: tasks.length })
  }

  /**
   * Read the atomic-task contract for a plan id, as a fresh copy.
   *
   * @param planId - The plan id.
   * @returns The registered tasks (a fresh array), or undefined when the
   *   plan id is not registered.
   */
  getPlanContract(planId: string): FactoryPlanTask[] | undefined {
    const contract = this.contracts.get(planId)
    return contract ? contract.map(task => ({ ...task })) : undefined
  }

  /**
   * List all registered plan ids, in registration order.
   *
   * @returns The registered plan ids.
   */
  listPlanIds(): string[] {
    return [...this.contracts.keys()]
  }

  /**
   * Deterministic BAR judge for a single task submission.
   *
   * PASS requires a non-empty normalized summary, a non-empty array of
   * non-empty normalized evidence strings, and a non-empty array of
   * non-empty normalized file paths. Any failed clause is reported with an
   * exact reason string.
   *
   * @param planId - The plan id the submission targets.
   * @param submission - The submitted work for one atomic task.
   * @returns The BAR verdict for the submission.
   * @throws {Error} When the plan id is unknown or the task id is not in the
   *   plan contract.
   */
  scoreTask(planId: string, submission: BarSubmission): BarVerdict {
    const contract = this.contracts.get(planId)
    if (!contract) {
      throw new Error(`factory: unknown plan contract "${planId}"`)
    }
    if (!contract.some(task => task.id === submission.taskId)) {
      throw new Error(`factory: task "${submission.taskId}" is not in plan contract "${planId}"`)
    }
    const passedChecks: string[] = []
    const reasons: string[] = []
    if (!normalizedText(submission.summary)) {
      reasons.push('summary must be a non-empty normalized string')
    } else {
      passedChecks.push('summary present')
    }
    const evidenceOk = Array.isArray(submission.evidence)
      && submission.evidence.length > 0
      && submission.evidence.every(normalizedText)
    if (!evidenceOk) {
      reasons.push('evidence must be a non-empty array of normalized strings')
    } else {
      passedChecks.push(`evidence present (${submission.evidence.length} items)`)
    }
    const filesOk = Array.isArray(submission.files)
      && submission.files.length > 0
      && submission.files.every(normalizedText)
    if (!filesOk) {
      reasons.push('files must be a non-empty array of normalized strings')
    } else {
      passedChecks.push(`files present (${submission.files.length} paths)`)
    }
    return {
      taskId: submission.taskId,
      status: reasons.length === 0 ? 'PASS' : 'FAIL',
      passedChecks,
      reasons,
    }
  }

  /**
   * Aggregate BAR score over a whole plan contract.
   *
   * Each contract task is scored against the FIRST submission with a
   * matching task id; tasks without a submission count as NOT_SUBMITTED.
   *
   * @param planId - The plan id to score.
   * @param submissions - The submissions for the plan's tasks.
   * @returns The aggregate contract score.
   * @throws {Error} When the plan id is unknown.
   */
  scoreContract(planId: string, submissions: BarSubmission[]): ContractScore {
    const contract = this.contracts.get(planId)
    if (!contract) {
      throw new Error(`factory: unknown plan contract "${planId}"`)
    }
    let submitted = 0
    let passed = 0
    let failed = 0
    for (const task of contract) {
      const submission = submissions.find(candidate => candidate.taskId === task.id)
      if (!submission) continue
      submitted += 1
      const verdict = this.scoreTask(planId, submission)
      if (verdict.status === 'PASS') passed += 1
      else failed += 1
    }
    return {
      planId,
      total: contract.length,
      submitted,
      passed,
      failed,
      verdict: submitted === contract.length && failed === 0 ? 'ALL_PASS' : 'FAIL',
    }
  }

  /**
   * Build the immutable planner objective for the ralph tool.
   * @param role - the planner role selector.
   * @param input - the planner input.
   * @returns the immutable planner objective string.
   */
  buildRoleObjective(role: 'planner', input: PlannerInput): string
  /**
   * Build the immutable developer objective for one atomic task.
   * @param role - the developer role selector.
   * @param task - the atomic task to build the objective for.
   * @param options - optional workspace override.
   * @returns the immutable developer objective string.
   */
  buildRoleObjective(role: 'developer', task: FactoryPlanTask, options?: { workspace?: string }): string
  /**
   * Build the immutable critic objective reviewing work against one atomic task.
   * @param role - the critic role selector.
   * @param task - the atomic task the work claims to complete.
   * @param work - the critic input: summary and changed files.
   * @returns the immutable critic objective string.
   */
  buildRoleObjective(role: 'critic', task: FactoryPlanTask, work: { summary: string; files: string[] }): string
  buildRoleObjective(role: 'planner' | 'developer' | 'critic', ...args: unknown[]): string {
    switch (role) {
      case 'planner':
        return plannerObjective(args[0] as PlannerInput)
      case 'developer':
        return developerObjective(args[0] as FactoryPlanTask, args[1] as { workspace?: string } | undefined)
      case 'critic':
        return criticObjective(args[0] as FactoryPlanTask, args[1] as { summary: string; files: string[] })
      default:
        throw new TypeError(`factory: unknown role "${String(role)}"`)
    }
  }
}

export default FactoryService

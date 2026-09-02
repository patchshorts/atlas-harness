// Pure role-objective builders for the factory workflow.
//
// These are the "workflow scripts over tool-ralph": tool-ralph takes exactly
// one immutable `objective: string` input, and these builders generate that
// input for each role (planner / developer / critic) from structured inputs.
// They are pure functions with no I/O, so they are fully unit-testable.

import type { FactoryPlanTask, PlannerInput } from './types.ts'

/** Local guard: value is a string, non-empty, and already trimmed. */
function normalizedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

/** Shared ralph round-report contract reminder for every role objective. */
const REPORT_CONTRACT = [
  'Report your round in the ralph tool format: status, summary, evidence, nextSteps, blocker.',
  'status "continue" requires nextSteps and an empty blocker;',
  'status "complete" requires evidence, no nextSteps, and an empty blocker;',
  'status "blocked" requires a concrete blocker.',
].join('\n')

/**
 * Build the immutable planner objective for tool-ralph.
 *
 * @param input - The planner scope and optional constraints.
 * @returns A multi-line non-empty normalized objective containing the role,
 *   the scope, the plan decomposition instructions (L0 vision, L1
 *   architecture, L2 milestones, L3 epics, L4 stories, L5 atomic tasks each
 *   with a verifies line), and the ralph round-report contract reminder.
 * @throws {TypeError} When the scope or any constraint is not a non-empty
 *   normalized string.
 */
export function plannerObjective(input: PlannerInput): string {
  if (!normalizedText(input.scope)) {
    throw new TypeError('planner scope must be a non-empty normalized string')
  }
  const constraints = input.constraints ?? []
  for (const constraint of constraints) {
    if (!normalizedText(constraint)) {
      throw new TypeError('planner constraints must be non-empty normalized strings')
    }
  }
  const constraintBlock = constraints.length > 0
    ? `Constraints:\n${constraints.map(constraint => `- ${constraint}`).join('\n')}`
    : 'No additional constraints.'
  const objective = [
    'planner',
    `Scope: ${input.scope}`,
    constraintBlock,
    'Produce a plan decomposition of the scope:',
    'L0 vision, L1 architecture, L2 milestones, L3 epics, L4 stories, L5 atomic tasks.',
    'Every L5 atomic task must carry a verifies line: a concrete, checkable completion condition.',
    REPORT_CONTRACT,
  ].join('\n\n')
  if (!normalizedText(objective)) {
    throw new TypeError('planner objective must be a non-empty normalized string')
  }
  return objective
}

/**
 * Build the immutable developer objective for one atomic task.
 *
 * @param task - The atomic task contract row to implement.
 * @param options - Optional workspace hint.
 * @returns A multi-line non-empty normalized objective containing the role,
 *   the task id/verb/object/verifies, an instruction to inspect the workspace
 *   first and verify against the verifies line before reporting complete, and
 *   the ralph round-report contract reminder.
 * @throws {TypeError} When any task field or the workspace is not a
 *   non-empty normalized string.
 */
export function developerObjective(task: FactoryPlanTask, options?: { workspace?: string }): string {
  if (!normalizedText(task.id) || !normalizedText(task.verb) || !normalizedText(task.object) || !normalizedText(task.verifies)) {
    throw new TypeError('developer task fields must be non-empty normalized strings')
  }
  if (options?.workspace !== undefined && !normalizedText(options.workspace)) {
    throw new TypeError('developer workspace must be a non-empty normalized string')
  }
  const objective = [
    'developer',
    `Task: ${task.id}`,
    `Verb: ${task.verb}`,
    `Object: ${task.object}`,
    `Verifies: ${task.verifies}`,
    options?.workspace !== undefined ? `Workspace: ${options.workspace}` : '',
    'Implement the atomic task. Inspect the workspace first, then verify against the verifies line before reporting complete.',
    REPORT_CONTRACT,
  ].filter(line => line !== '').join('\n\n')
  if (!normalizedText(objective)) {
    throw new TypeError('developer objective must be a non-empty normalized string')
  }
  return objective
}

/**
 * Build the immutable critic objective reviewing work against one atomic task.
 *
 * @param task - The atomic task contract row the work must satisfy.
 * @param work - The submitted work: a summary and the touched file paths.
 * @returns A multi-line non-empty normalized objective containing the role,
 *   the task id and verifies line, the work summary, each file path, an
 *   instruction to adversarially review the work against the verifies line and
 *   return PASS or FAIL with required changes, and the ralph round-report
 *   contract reminder.
 * @throws {TypeError} When any task field, the work summary, or any file
 *   path is not a non-empty normalized string.
 */
export function criticObjective(task: FactoryPlanTask, work: { summary: string; files: string[] }): string {
  if (!normalizedText(task.id) || !normalizedText(task.verb) || !normalizedText(task.object) || !normalizedText(task.verifies)) {
    throw new TypeError('critic task fields must be non-empty normalized strings')
  }
  if (!normalizedText(work.summary)) {
    throw new TypeError('critic work summary must be a non-empty normalized string')
  }
  for (const file of work.files) {
    if (!normalizedText(file)) {
      throw new TypeError('critic work files must be non-empty normalized strings')
    }
  }
  const objective = [
    'critic',
    `Task: ${task.id}`,
    `Verifies: ${task.verifies}`,
    `Work summary: ${work.summary}`,
    'Files:',
    ...work.files.map(file => `- ${file}`),
    'Adversarially review the work against the task verifies line and return PASS or FAIL with required changes.',
    REPORT_CONTRACT,
  ].join('\n\n')
  if (!normalizedText(objective)) {
    throw new TypeError('critic objective must be a non-empty normalized string')
  }
  return objective
}

// Pure deterministic vote rules for the Pass 4 three-panel judge.
//
// Each vote is computed from the request + nothing else (the fresh-context
// guarantee for the deterministic engine: no shared state between ballots).
// Pure functions — no I/O, no `this`. Every NO carries exact reason strings.

import type { JudgePlanTask, JudgeRequest, JudgeVote } from './types.ts'

/** Local guard: value is a string, non-empty, and already trimmed. */
function normalizedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

/** The NO ballot for a set of exact reasons. */
function no(request: JudgeRequest, role: JudgeVote['role'], reasons: string[]): JudgeVote {
  return { role, judgmentId: request.judgmentId, planId: request.planId, kind: request.kind, vote: 'NO', reasons }
}

/** The YES ballot with the canonical positive reason. */
function yes(request: JudgeRequest, role: JudgeVote['role'], reasons: string[]): JudgeVote {
  return { role, judgmentId: request.judgmentId, planId: request.planId, kind: request.kind, vote: 'YES', reasons }
}

/** The decomposition veto: every task is one verb + one object + one checkable verifies. */
function planEssentials(request: JudgeRequest): string[] {
  const tasks = request.tasks
  const reasons: string[] = []
  if (!Array.isArray(tasks) || tasks.length === 0) {
    reasons.push('plan has no tasks')
    return reasons
  }
  const seen = new Set<string>()
  for (const task of tasks) {
    if (!normalizedText(task.id)) {
      reasons.push('task lacks a non-empty id')
      continue
    }
    if (seen.has(task.id)) {
      reasons.push(`duplicate task id ${task.id}`)
    }
    seen.add(task.id)
    if (!normalizedText(task.verb)) {
      reasons.push(`task ${task.id} lacks a non-empty verb`)
    }
    if (!normalizedText(task.object)) {
      reasons.push(`task ${task.id} lacks a non-empty object`)
    }
    if (!normalizedText(task.verifies)) {
      reasons.push(`task ${task.id} lacks a non-empty verifies`)
    }
  }
  for (const task of tasks) {
    if (normalizedText(task.verifies) && normalizedText(task.object) && task.verifies === task.object) {
      reasons.push(`task ${task.id} verifies is not checkable: identical to its object`)
    }
    if (normalizedText(task.object) && (task.object.includes(' and ') || task.object.includes(', '))) {
      reasons.push(`task ${task.id} object names multiple deliverables: split it`)
    }
  }
  return reasons
}

/**
 * The decomposition vote — the hard criterion (decomposition veto). NO when
 * the plan has no tasks, any task lacks a non-empty id/verb/object/verifies,
 * task ids are duplicated, a verifies line is identical to its object, or an
 * object names multiple deliverables.
 *
 * @param request - the judgment request (the only input; fresh context).
 * @returns the decomposition ballot.
 */
export function decompositionVote(request: JudgeRequest): JudgeVote {
  const reasons = planEssentials(request)
  if (reasons.length > 0) return no(request, 'decomposition', reasons)
  return yes(request, 'decomposition', ['every task is one verb + one object + one checkable verifies'])
}

/**
 * The feasibility vote — evidence-based dissent, never averaging. NO when the
 * plan has no tasks, a verifies line is uncheckable (identical to its object),
 * every verifies line is uncheckable, a completion lacks a submission, or a
 * triage lacks a next action.
 *
 * @param request - the judgment request (the only input; fresh context).
 * @returns the feasibility ballot.
 */
export function feasibilityVote(request: JudgeRequest): JudgeVote {
  const reasons: string[] = []
  const tasks = request.tasks
  if (!Array.isArray(tasks) || tasks.length === 0) {
    reasons.push('plan has no tasks')
  } else {
    let uncheckable = 0
    for (const task of tasks) {
      if (normalizedText(task.verifies) && normalizedText(task.object) && task.verifies === task.object) {
        reasons.push(`task ${task.id} verifies is uncheckable: identical to its object`)
        uncheckable += 1
      }
    }
    if (uncheckable === tasks.length) {
      reasons.push('every task verifies is uncheckable')
    }
  }
  if (request.kind === 'completion' && !request.submission) {
    reasons.push('completion lacks a submission')
  }
  if (request.kind === 'triage' && !normalizedText(request.triage?.nextAction)) {
    reasons.push('triage lacks a next action')
  }
  if (reasons.length > 0) return no(request, 'feasibility', reasons)
  return yes(request, 'feasibility', ['plan is executable: every task has a checkable verifies boundary'])
}

/**
 * The verification vote — completion is owned by the verifier. For
 * 'completion' NO when the plan artifact was not approved by the panel, the
 * summary is missing, or the completion is self-declared without evidence or
 * files. For 'plan' the same essentials as the decomposition vote. For
 * 'triage' NO when failure context or evidence is missing.
 *
 * @param request - the judgment request (the only input; fresh context).
 * @param planApproved - whether the plan artifact was previously approved by
 *   the panel; consulted for kind 'completion' only.
 * @returns the verification ballot.
 */
export function verifiableVote(request: JudgeRequest, planApproved: boolean): JudgeVote {
  const reasons: string[] = []
  switch (request.kind) {
    case 'completion': {
      if (!planApproved) reasons.push('plan artifact not approved by panel')
      if (!normalizedText(request.submission?.summary)) reasons.push('completion summary missing')
      if (!Array.isArray(request.submission?.evidence) || request.submission.evidence.length === 0) {
        reasons.push('self-declared completion without evidence')
      }
      if (!Array.isArray(request.submission?.files) || request.submission.files.length === 0) {
        reasons.push('self-declared completion without files')
      }
      if (reasons.length > 0) return no(request, 'verification', reasons)
      return yes(request, 'verification', ['completion carries summary, evidence, and files'])
    }
    case 'plan': {
      const essentials = planEssentials(request)
      if (essentials.length > 0) return no(request, 'verification', essentials)
      return yes(request, 'verification', ['completion is evidence-backed and the plan artifact was approved'])
    }
    case 'triage': {
      if (!normalizedText(request.triage?.failure)) reasons.push('triage lacks failure context')
      if (!Array.isArray(request.triage?.evidence) || request.triage.evidence.length === 0) {
        reasons.push('triage lacks evidence')
      }
      if (reasons.length > 0) return no(request, 'verification', reasons)
      return yes(request, 'verification', ['triage carries failure context and evidence'])
    }
    default: {
      // Unreachable: JudgeKind is a closed union; defensive for callers that
      // cast an arbitrary string.
      return no(request, 'verification', [`unknown kind ${String(request.kind)}`])
    }
  }
}

/** Shared checkable-boundary helper used by the vote rules above. */
export function isTaskCheckable(task: JudgePlanTask): boolean {
  return normalizedText(task.verifies) && normalizedText(task.object) && task.verifies !== task.object
}

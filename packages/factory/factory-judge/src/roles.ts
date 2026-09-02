// Immutable judge charters (fresh context per judge).
//
// Each charter is role + kind only: the caller supplies the plan artifact text
// through its own model call. Pure function — no I/O, no `this`.

import type { JudgeKind, JudgePanelRole } from './types.ts'

/** The role-specific charter body, verbatim per role. */
const CHARTERS: Record<JudgePanelRole, string> = {
  decomposition:
    'You receive ONLY the plan artifact and this charter — never the planner\'s reasoning or history. '
    + 'Vote NO unless the plan is decomposed to its smallest independently verifiable pieces: every task is ONE verb + ONE object + ONE checkable verifies line. '
    + 'Unanimity is required to pass; dissent must cite the artifact.',
  feasibility:
    'You receive ONLY the plan artifact and this charter. '
    + 'Vote NO when any task is not executable or its verifies boundary is uncheckable. '
    + 'Evidence-based dissent is required — never average or compromise toward a pass.',
  verification:
    'Completion is owned by the verifier, never self-declared. '
    + 'PASS requires evidence: a summary, evidence items, and file paths. '
    + 'A false PASS propagates; a false FAIL burns a replan.',
}

/** The three panel roles in canonical order. */
const ROLES: readonly JudgePanelRole[] = ['decomposition', 'feasibility', 'verification']

/** The three judgment kinds. */
const KINDS: readonly JudgeKind[] = ['plan', 'triage', 'completion']

/**
 * Build the immutable charter for one judge role and judgment kind. Opens with
 * the role, then an artifact line, then the role charter, and ends with the
 * exact-vote instruction. The charter is role + kind only — the caller
 * supplies the plan artifact text via its own model call.
 *
 * @param role - the panel role whose charter to build.
 * @param kind - the judgment surface the charter covers.
 * @returns a non-empty normalized multi-line objective.
 * @throws {TypeError} When the role or kind is unknown.
 */
export function judgeRoleObjective(role: JudgePanelRole, kind: JudgeKind): string {
  if (!ROLES.includes(role)) {
    throw new TypeError(`factory-judge: unknown judge role "${role}"`)
  }
  if (!KINDS.includes(kind)) {
    throw new TypeError(`factory-judge: unknown judge kind "${kind}"`)
  }
  return [
    role,
    `Artifact: ${kind} judgment — the caller supplies the plan artifact text via its own model call.`,
    CHARTERS[role],
    'Vote YES or NO with exact reasons citing the artifact.',
  ].join('\n\n')
}

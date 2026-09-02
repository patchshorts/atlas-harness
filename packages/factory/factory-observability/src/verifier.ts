// Deterministic completion verifier: completion is owned by the verifier,
// never self-declared. Pure and deterministic — no LLM, no I/O. The TNR gate
// exists because LLM judges accept nearly everything (TNR < 25% vs TPR > 96%):
// a verifier that passes negative fixtures certifies garbage.

import type {
  CompletionCheck,
  CompletionClaim,
  CompletionVerdict,
  VerifierFixture,
  VerifierStats,
} from './types.ts'

/**
 * Verify a completion claim against the checks.
 *
 * Rule order: (1) a self-declared completion with no evidence is rejected;
 * (2) no checks defined is a FAIL; (3) PASS only when EVERY check's clause is
 * satisfied by at least one evidence string (case-insensitive substring);
 * every unsatisfied check is cited in the reasons.
 *
 * @param claim - the completion claim (taskId, summary, evidence, selfDeclared).
 * @param checks - the checks the evidence must satisfy.
 * @returns the verdict: PASS with empty reasons, or FAIL with every failed
 *   check cited.
 */
export function verifyCompletion(claim: CompletionClaim, checks: CompletionCheck[]): CompletionVerdict {
  if (claim.selfDeclared && claim.evidence.length === 0) {
    return { taskId: claim.taskId, status: 'FAIL', reasons: ['self-declared completion rejected'] }
  }
  if (checks.length === 0) {
    return { taskId: claim.taskId, status: 'FAIL', reasons: ['no verification checks defined'] }
  }
  const reasons: string[] = []
  for (const check of checks) {
    const satisfied = claim.evidence.some(evidence =>
      evidence.toLowerCase().includes(check.clause.toLowerCase()),
    )
    if (!satisfied) {
      reasons.push(`evidence does not satisfy check "${check.id}": ${check.clause}`)
    }
  }
  return reasons.length === 0
    ? { taskId: claim.taskId, status: 'PASS', reasons: [] }
    : { taskId: claim.taskId, status: 'FAIL', reasons }
}

/**
 * Validate a verifier implementation against fixtures, reporting TPR/TNR.
 * Never throws on a fixture mismatch — mismatches are collected into the
 * stats.
 *
 * @param verify - the verifier under test.
 * @param fixtures - the positive and negative fixtures with expected verdicts.
 * @returns the verifier stats: tpr, tnr, and the fixture counts.
 */
export function validateVerifier(
  verify: (claim: CompletionClaim, checks: CompletionCheck[]) => CompletionVerdict,
  fixtures: VerifierFixture[],
): VerifierStats {
  let positives = 0
  let negatives = 0
  let positivePass = 0
  let negativeFail = 0
  for (const fixture of fixtures) {
    const verdict = verify(fixture.claim, fixture.checks)
    if (fixture.kind === 'positive') {
      positives++
      if (verdict.status === 'PASS') positivePass++
    } else {
      negatives++
      if (verdict.status === 'FAIL') negativeFail++
    }
  }
  return {
    tpr: positives === 0 ? 0 : positivePass / positives,
    tnr: negatives === 0 ? 0 : negativeFail / negatives,
    positives,
    negatives,
  }
}

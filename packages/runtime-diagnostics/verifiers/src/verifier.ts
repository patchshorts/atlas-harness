/**
 * Hardened verifier evaluation over labeled fixtures.
 *
 * D7 (Fix 6/7): every verifier must be validated on NEGATIVE fixtures —
 * known-bad inputs it is contractually required to reject. The worst failure
 * mode is a verifier that passes everything: a passing-everything judge is
 * worse than none, because it converts an untrusted exhaust into a false seal
 * of correctness. This module detects that mode with a true-negative-rate
 * guard and separately gates bare ballots with an evidence truth gate.
 *
 * ## Golden rule
 *
 * Evaluation is a pure fold over the verifier's ballots. It never mutates the
 * verifier, the fixtures, the ballots, or any event; it never writes model-
 * visible history. The returned report is a fresh projection.
 *
 * @module @atlasai/atsh-runtime-verifiers/src/verifier
 */

import type {
  Fixture,
  FixtureExpectation,
  Verdict,
  Verifier,
  VerifierBallot,
  VerifierCounts,
} from './types.ts'

/** The minimum true-negative rate below which a verifier is untrustworthy. */
export const MIN_TRUE_NEGATIVE_RATE = 0.25

/** The default minimum evidence length a `pass` ballot must carry. */
export const MIN_EVIDENCE_CHARS = 1

/** Options for {@link evaluateVerifier}. */
export interface VerifierOptions {
  /**
   * True-negative rate floor. A verifier whose rejection rate on labeled
   * negatives falls below this is judged untrustworthy (all-pass debt).
   * @default MIN_TRUE_NEGATIVE_RATE
   */
  readonly minTrueNegativeRate?: number
  /**
   * Minimum evidence characters a `pass` ballot must carry to pass the truth
   * gate. Shorter evidence is a bare assertion.
   * @default MIN_EVIDENCE_CHARS
   */
  readonly minEvidenceChars?: number
}

/**
 * The hardening decision over one verifier + a labeled fixture battery.
 * `verdict` is `pass` only when the verifier is trusted, `fail` when the
 * true-negative guard fires, and `unvalidated` when the battery carries no
 * negative fixture to measure the guard. `replan` is never a verdict here — a
 * verifier under hardening review either passes the guard or does not.
 */
export interface VerifierReport {
  /** The final trust decision over this verifier. */
  readonly verdict: 'pass' | 'fail' | 'unvalidated'
  /** Confusion-matrix counts over the labeled fixtures. */
  readonly counts: VerifierCounts
  /**
   * True-negative rate, or `null` when the battery has no negative fixture to
   * measure it against.
   */
  readonly trueNegativeRate: number | null
  /** Human-readable reasons for a non-pass verdict (empty on pass). */
  readonly reasons: readonly string[]
}

/**
 * Classify one fixture ballot strictly: whether the verifier PASSED a labeled
 * NEGATIVE fixture. A `pass` on a known-bad input is the all-pass debt — the
 * exact failure the TNR guard exists to catch.
 *
 * Any verdict other than `pass` (fail or replan) counts as a rejection: the
 * three-panel contract treats a single NO as a replan, never a pass.
 *
 * @param fixture - the labeled fixture the ballot is about.
 * @param ballot - the verifier's judgment over it.
 * @returns true when the verifier wrongly passed a known-bad input.
 */
export function isFalsePositive(
  fixture: Fixture,
  ballot: VerifierBallot,
): boolean {
  return fixture.expectation === 'fail' && ballot.verdict === 'pass'
}

/**
 * Empty-results verdict used when a battery lacks negative fixtures.
 * The guard cannot be evaluated without them.
 */
export const UNVALIDATED: VerifierReport = Object.freeze({
  verdict: 'unvalidated',
  counts: emptyCounts(),
  trueNegativeRate: null,
  reasons: ['no negative fixture in battery: the TNR guard is not evaluatable'],
})

/**
 * Run one verifier over a labeled fixture battery and compute the hardening
 * report.
 *
 * Each fixture's ground truth is compared to the verifier's ballot. The fold
 * tallies the confusion matrix (true/false negatives/positives) and the
 * true-negative rate. When negatives exist and the rate is below
 * `minTrueNegativeRate`, the verifier is rejected as all-pass debt. When the
 * battery has no negatives, the guard is unimplemented and the verdict is
 * `unvalidated` (callers that care must supply negatives).
 *
 * @param verifier - the verifier under test (must be pure).
 * @param fixtures - labeled fixtures, on or both expectation classes.
 * @param options - guard tuning.
 * @returns a fresh report; nothing is mutated.
 */
export function evaluateVerifier(
  verifier: Verifier,
  fixtures: readonly Fixture[],
  options: VerifierOptions = {},
): VerifierReport {
  const minRate = options.minTrueNegativeRate ?? MIN_TRUE_NEGATIVE_RATE
  const counts = emptyCounts()
  for (const fixture of fixtures) {
    const ballot = verifier(fixture)
    switch (ballot.verdict) {
      case 'pass':
        counts.pass += 1
        if (fixture.expectation === 'fail') counts.falsePositives += 1
        else counts.truePositives += 1
        break
      case 'fail':
        counts.fail += 1
        if (fixture.expectation === 'fail') counts.trueNegatives += 1
        else counts.falseNegatives += 1
        break
      default:
        // replan: counted as a rejection on a negative (never a pass),
        // and as a missed positive when the fixture should pass.
        counts.replan += 1
        if (fixture.expectation === 'fail') counts.trueNegatives += 1
        else counts.falseNegatives += 1
        break
    }
  }
  const negative = counts.trueNegatives + counts.falsePositives
  if (negative === 0) return UNVALIDATED
  const tnr = counts.trueNegatives / negative
  if (tnr < minRate) {
    return {
      verdict: 'fail',
      counts: frozenCounts(counts),
      trueNegativeRate: tnr,
      reasons: [
        `true-negative rate ${tnr.toFixed(3)} below floor ${minRate.toFixed(3)}: ` +
          'passing-everything verifier detected',
      ],
    }
  }
  return { verdict: 'pass', counts: frozenCounts(counts), trueNegativeRate: tnr, reasons: [] }
}

/**
 * The truth gate: is THIS ballot a proven judgment, or a bare assertion?
 *
 * A `pass` verdict must carry evidence of at least `minEvidenceChars` to carry
 * the unanimity-with-evidence contract (three-panel, arXiv 2602.01011). Non-
 * pass verdicts are never gated at the ballot level — the three-panel treats
 * a NO as a legitimate dissent even with an empty reason.
 *
 * @param ballot - the ballot under review.
 * @param options - optional evidence floor override.
 * @returns whether the ballot counts as evidenced.
 */
export function truthGate(
  ballot: VerifierBallot,
  options: { readonly minEvidenceChars?: number } = {},
): boolean {
  if (ballot.verdict !== 'pass') return true
  const min = options.minEvidenceChars ?? MIN_EVIDENCE_CHARS
  return (ballot.evidence ?? '').trim().length >= min
}

/** A freshly-zeroed confusion matrix (never leaks state between calls). */
function emptyCounts(): {
  pass: number
  fail: number
  replan: number
  trueNegatives: number
  falsePositives: number
  truePositives: number
  falseNegatives: number
} {
  return {
    pass: 0,
    fail: 0,
    replan: 0,
    trueNegatives: 0,
    falsePositives: 0,
    truePositives: 0,
    falseNegatives: 0,
  }
}

/** Freeze a mutable counter into the readonly report shape. */
function frozenCounts(c: {
  pass: number
  fail: number
  replan: number
  trueNegatives: number
  falsePositives: number
  truePositives: number
  falseNegatives: number
}): VerifierCounts {
  return {
    pass: c.pass,
    fail: c.fail,
    replan: c.replan,
    trueNegatives: c.trueNegatives,
    falsePositives: c.falsePositives,
    truePositives: c.truePositives,
    falseNegatives: c.falseNegatives,
  }
}

/** The expectation classes a fixture battery can carry. */
export const EXPECTATIONS: readonly FixtureExpectation[] = ['pass', 'fail']

/** The verdicts a verifier can cast. */
export const VERDICTS: readonly Verdict[] = ['pass', 'fail', 'replan']

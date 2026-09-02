/**
 * Typed vocabulary of the hardened verifier.
 *
 * A verifier is a judgment function that casts a ballot on a fixture under
 * review. The hardening layer evaluates the verifier against a LABELED set of
 * fixtures (known-good and known-bad) and rejects it as untrustworthy when its
 * true-negative rate collapses — the D7 "passing-everything judge" failure
 * mode, where a verifier that returns `pass` on everything is worse than no
 * verifier at all.
 *
 * ## Golden rule
 *
 * Verifier evaluation is a pure fold over fixture ballots. It never mutates
 * the fixtures, the verifier, a ballot, or any event stream — it only reads
 * what the verifier returned and computes statistics. No model-visible history
 * is written.
 *
 * @module @atlasai/atsh-runtime-verifiers/src/types
 */

/** One verdict a verifier can cast over a fixture. */
export type Verdict = 'pass' | 'fail' | 'replan'

/**
 * The ground-truth label of a fixture: whether the fixture under review SHOULD
 * pass verification. A NEGATIVE fixture is a known-bad input the verifier must
 * reject; calling it `pass` is a false positive (the all-pass failure mode).
 */
export type FixtureExpectation = 'pass' | 'fail'

/**
 * A single fixture (case) under verification.
 *
 * The `expectation` is the authoritative label — it is what the verifier's
 * judgment is checked against. `subject` is optional human context.
 */
export interface Fixture {
  /** Stable fixture identifier. */
  readonly id: string
  /** The known-good / known-bad label the verifier must match. */
  readonly expectation: FixtureExpectation
  /** Optional human-readable description of what the fixture tests. */
  readonly subject?: string
}

/**
 * One verifier's judgment over a fixture.
 *
 * `evidence` carries the justification for the verdict. A `pass` ballot with
 * no (or trivially short) evidence is a bare assertion — the truth gate
 * rejects it as unproven even when its verdict happens to match.
 */
export interface VerifierBallot {
  /** The verdict this verifier cast. */
  readonly verdict: Verdict
  /** Optional justification text; empty/trivial evidence fails the gate. */
  readonly evidence?: string
}

/**
 * A verifier is a pure judgment function: it reads one fixture and returns a
 * ballot. Verifiers never mutate inputs and never touch model-visible history.
 */
export type Verifier = (fixture: Fixture) => VerifierBallot

/**
 * Confusion-matrix counts of a verifier's ballots against a labeled fixture
 * set. These are the raw statistics the true-negative-rate guard reads.
 */
export interface VerifierCounts {
  /** Fixtures the verifier classified as `pass`. */
  readonly pass: number
  /** Fixtures the verifier classified as `fail`. */
  readonly fail: number
  /** Fixtures the verifier classified as `replan`. */
  readonly replan: number
  /** Labeled NEGATIVE fixtures the verifier correctly rejected. */
  readonly trueNegatives: number
  /** Labeled NEGATIVE fixtures the verifier wrongly passed (all-pass debt). */
  readonly falsePositives: number
  /** Labeled POSITIVE fixtures the verifier correctly passed. */
  readonly truePositives: number
  /** Labeled POSITIVE fixtures the verifier wrongly rejected. */
  readonly falseNegatives: number
}

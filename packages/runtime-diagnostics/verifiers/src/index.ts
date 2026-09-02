/**
 * Hardened verifier correctness for DeepSeek Harness.
 *
 * D7 (Fix 6/7): every verifier must be validated on NEGATIVE fixtures — known-
 * bad inputs it must reject. The true-negative-rate guard catches the
 * passing-everything judge (a verifier that accepts anything converts
 * untrusted exhaust into a false seal of correctness); the truth gate rejects
 * bare `pass` ballots that carry no evidence. Verifiers are pure folds over
 * labeled fixtures — they never mutate a stream or model-visible history
 * (golden rule).
 *
 * @module @atlasai/atsh-runtime-verifiers
 */

export {
  EXPECTATIONS,
  MIN_EVIDENCE_CHARS,
  MIN_TRUE_NEGATIVE_RATE,
  UNVALIDATED,
  VERDICTS,
  evaluateVerifier,
  isFalsePositive,
  truthGate,
} from './verifier.ts'
export type { VerifierOptions, VerifierReport } from './verifier.ts'
export type {
  Fixture,
  FixtureExpectation,
  Verdict,
  Verifier,
  VerifierBallot,
  VerifierCounts,
} from './types.ts'

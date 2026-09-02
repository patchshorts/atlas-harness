/**
 * negative-fixture verifier spec
 *
 * Proves the D7 contract for the hardened verifier: every verifier is validated
 * on >=5 DISTINCT NEGATIVE fixtures (expectation 'fail'), a passing-everything
 * judge is detected as all-pass debt by the true-negative-rate guard, the truth
 * gate separates bare assertions from evidenced judgments, and the evaluation
 * fold never mutates its input fixtures (golden-rule purity).
 */
import { describe, expect, it } from 'vitest'
import {
  evaluateVerifier,
  isFalsePositive,
  truthGate,
  UNVALIDATED,
  MIN_TRUE_NEGATIVE_RATE,
} from '@atlasai/atsh-runtime-verifiers'

import type {
  Fixture,
  Verifier,
} from '@atlasai/atsh-runtime-verifiers'

/**
 * >=5 DISTINCT negative fixtures: each describes a real known-bad input.
 * Each carries a unique id and a unique subject naming the specific defect.
 */
const NEGATIVES: readonly Fixture[] = [
  {
    id: 'neg-1',
    expectation: 'fail',
    subject: 'malformed tool-call output: missing closing brace in JSON payload',
  },
  {
    id: 'neg-2',
    expectation: 'fail',
    subject: 'over-budget token phrase: response exceeds 4x the allowed window',
  },
  {
    id: 'neg-3',
    expectation: 'fail',
    subject: 'evidence-less ballot request: pass verdict with no evidence string',
  },
  {
    id: 'neg-4',
    expectation: 'fail',
    subject: 'contradictory claim: two statements in one pass that conflict',
  },
  {
    id: 'neg-5',
    expectation: 'fail',
    subject: 'out-of-domain input: message outside the verifier licensed scope',
  },
]

/** A couple of positive (expectation 'pass') fixtures, sound inputs. */
const POSITIVES: readonly Fixture[] = [
  { id: 'pos-1', expectation: 'pass', subject: 'well-formed and in-scope request' },
  { id: 'pos-2', expectation: 'pass', subject: 'complete, non-redundant answer' },
]

/** Passing-everything judge: trusts everything, never rejects. */
const allPassJudge: Verifier = () => ({ verdict: 'pass' as const, evidence: 'accepted' })

/**
 * A good verifier: rejects known-bad negatives, passes sound positives, and
 * always backs its verdict with evidence.
 */
const goodJudge: Verifier = fixture =>
  fixture.expectation === 'fail'
    ? { verdict: 'fail' as const, evidence: 'rejecting known-bad: ' + fixture.subject }
    : { verdict: 'pass' as const, evidence: 'fixture is sound' }

/** Build a deep-frozen battery from the given fixture lists. */
function buildFixtures(...groups: readonly (readonly Fixture[])[]): readonly Fixture[] {
  const fixtureList: Fixture[] = ([] as Fixture[]).concat(...groups.map(g => [...g]))
  fixtureList.forEach(f => Object.freeze(f))
  return Object.freeze(fixtureList)
}

describe('negative-fixture verifier spec', () => {
  it('declares at least 5 distinct negative fixtures and a couple of positives', () => {
    const ids = new Set(NEGATIVES.map(n => n.id))
    const subjects = new Set(NEGATIVES.map(n => n.subject))
    expect(NEGATIVES.length).toBeGreaterThanOrEqual(5)
    expect(ids.size).toBe(NEGATIVES.length) // unique ids
    expect(subjects.size).toBe(NEGATIVES.length) // distinct subjects
    expect(POSITIVES.length).toBeGreaterThanOrEqual(2)
  })

  it('rejects the passing-everything judge on the negatives-only battery (TNR = 0)', () => {
    const negativesOnly: readonly Fixture[] = buildFixtures(NEGATIVES)
    const report = evaluateVerifier(allPassJudge, negativesOnly)

    expect(report.verdict).toBe('fail')
    expect(report.trueNegativeRate).toBe(0)
    expect(report.counts.falsePositives).toBe(NEGATIVES.length)
    expect(report.counts.trueNegatives).toBe(0)
    expect(report.reasons.length).toBeGreaterThan(0)
  })

  it('rejects the passing-everything judge on a mixed battery too', () => {
    const mixed: readonly Fixture[] = buildFixtures(NEGATIVES, POSITIVES)
    const report = evaluateVerifier(allPassJudge, mixed)

    expect(report.verdict).toBe('fail') // guard fires because negatives exist
    expect(report.counts.falsePositives).toBe(NEGATIVES.length)
    expect(report.counts.truePositives).toBe(POSITIVES.length)
  })

  it('trusts the good verifier (control: TNR = 1, zero false positives)', () => {
    const mixed: readonly Fixture[] = buildFixtures(NEGATIVES, POSITIVES)
    const report = evaluateVerifier(goodJudge, mixed)

    expect(report.verdict).toBe('pass')
    expect(report.trueNegativeRate).toBe(1)
    expect(report.counts.trueNegatives).toBe(NEGATIVES.length)
    expect(report.counts.falsePositives).toBe(0)
  })

  it('exercises every negative through the real reject path', () => {
    // The good judge's rejection of each neg is NOT a false positive...
    for (const neg of NEGATIVES) {
      expect(isFalsePositive(neg, goodJudge(neg))).toBe(false)
    }
    // ...while the all-pass judge's pass on each neg IS the debt.
    for (const neg of NEGATIVES) {
      expect(isFalsePositive(neg, allPassJudge(neg))).toBe(true)
    }
  })

  it('returns UNVALIDATED when no negatives are present', () => {
    const positivesOnly: readonly Fixture[] = buildFixtures(POSITIVES)
    const report = evaluateVerifier(goodJudge, positivesOnly)

    expect(report.verdict).toBe('unvalidated')
    expect(report.trueNegativeRate).toBeNull()
    expect(report).toEqual(UNVALIDATED)
  })

  it('truth gate separates bare assertions from evidenced judgments', () => {
    expect(truthGate({ verdict: 'pass' as const })).toBe(false) // bare pass, no evidence
    expect(truthGate({ verdict: 'pass' as const, evidence: 'a' })).toBe(true)
    expect(truthGate({ verdict: 'pass' as const, evidence: '   ' })).toBe(false) // whitespace
    expect(truthGate({ verdict: 'fail' as const })).toBe(true) // NO is legitimate w/ empty evidence
    expect(truthGate({ verdict: 'replan' as const })).toBe(true)
    expect(truthGate({ verdict: 'pass' as const }, { minEvidenceChars: 5 })).toBe(false) // 'abc' too short
  })

  it('never mutates fixtures across the evaluation fold (golden-rule purity)', () => {
    const battery: readonly Fixture[] = buildFixtures(NEGATIVES, POSITIVES)
    const before = JSON.stringify(battery)

    evaluateVerifier(goodJudge, battery)
    evaluateVerifier(allPassJudge, battery)

    expect(JSON.stringify(battery)).toBe(before)
    for (const fixture of battery) {
      expect(Object.isFrozen(fixture)).toBe(true)
    }
  })

  it('exposes the true-negative-rate floor constant', () => {
    expect(MIN_TRUE_NEGATIVE_RATE).toBe(0.25)
  })
})

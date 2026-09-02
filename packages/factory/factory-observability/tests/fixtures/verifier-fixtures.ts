// Verifier fixtures for the observability package (Fix 6/7).
//
// EXACTLY 6 positive and 6 negative fixtures (12 total). The TNR gate exists
// because LLM judges accept nearly everything (TNR < 25% vs TPR > 96%): a
// verifier that passes negative fixtures certifies garbage, so it MUST be
// validated on negatives. The deterministic verifier here is expected to hit
// tpr 1.0 and tnr 1.0 on this set.

import type { VerifierFixture } from '../../src/types.ts'

export const VERIFIER_FIXTURES: VerifierFixture[] = [
  // ---- Positive (all should PASS) ----
  {
    id: 'pos-evidence-covers-checks',
    kind: 'positive',
    claim: {
      taskId: 't1',
      summary: 'auth module implemented',
      evidence: ['implemented login() and added auth tests'],
      selfDeclared: false,
    },
    checks: [
      { id: 'login', clause: 'login' },
      { id: 'tests', clause: 'auth tests' },
    ],
    expected: 'PASS',
  },
  {
    id: 'pos-not-self-declared',
    kind: 'positive',
    claim: {
      taskId: 't2',
      summary: 'parser hardened',
      evidence: ['wrote tests for the parser'],
      selfDeclared: false,
    },
    checks: [{ id: 'tests', clause: 'parser' }],
    expected: 'PASS',
  },
  {
    id: 'pos-single-check',
    kind: 'positive',
    claim: {
      taskId: 't3',
      summary: 'dark mode shipped',
      evidence: ['dark mode shipped in the settings panel'],
      selfDeclared: false,
    },
    checks: [{ id: 'feature', clause: 'dark mode' }],
    expected: 'PASS',
  },
  {
    id: 'pos-uppercase-evidence',
    kind: 'positive',
    claim: {
      taskId: 't4',
      summary: 'login flow verified',
      evidence: ['LOGIN WORKS'],
      selfDeclared: false,
    },
    // Case-insensitive substring: 'login works'.includes('login') → PASS.
    checks: [{ id: 'login', clause: 'login' }],
    expected: 'PASS',
  },
  {
    id: 'pos-multi-evidence',
    kind: 'positive',
    claim: {
      taskId: 't5',
      summary: 'auth complete',
      evidence: ['implemented login()', 'added auth tests'],
      selfDeclared: false,
    },
    // Checks split across the two evidence strings.
    checks: [
      { id: 'login', clause: 'login' },
      { id: 'tests', clause: 'auth tests' },
    ],
    expected: 'PASS',
  },
  {
    id: 'pos-summary-irrelevant',
    kind: 'positive',
    claim: {
      taskId: 't6',
      summary: '',
      evidence: ['endpoint /health responds 200'],
      selfDeclared: false,
    },
    // Evidence is the gate, not the summary.
    checks: [{ id: 'health', clause: '/health responds' }],
    expected: 'PASS',
  },

  // ---- Negative (all should FAIL) ----
  {
    id: 'neg-self-declared-empty',
    kind: 'negative',
    claim: {
      taskId: 't7',
      summary: 'done',
      evidence: [],
      selfDeclared: true,
    },
    checks: [{ id: 'login', clause: 'login' }],
    expected: 'FAIL',
  },
  {
    id: 'neg-no-checks',
    kind: 'negative',
    claim: {
      taskId: 't8',
      summary: 'implemented',
      evidence: ['implemented login()'],
      selfDeclared: false,
    },
    checks: [],
    expected: 'FAIL',
  },
  {
    id: 'neg-evidence-missing-clause',
    kind: 'negative',
    claim: {
      taskId: 't9',
      summary: 'implemented',
      evidence: ['implemented login()'],
      selfDeclared: false,
    },
    // Fails the 'tests' check: no evidence string contains 'auth tests'.
    checks: [
      { id: 'login', clause: 'login' },
      { id: 'tests', clause: 'auth tests' },
    ],
    expected: 'FAIL',
  },
  {
    id: 'neg-empty-everything',
    kind: 'negative',
    claim: {
      taskId: 't10',
      summary: '',
      evidence: [],
      selfDeclared: false,
    },
    checks: [{ id: 'login', clause: 'login' }],
    expected: 'FAIL',
  },
  {
    id: 'neg-case-sensitive-false',
    kind: 'negative',
    claim: {
      taskId: 't11',
      summary: 'login',
      evidence: ['login'],
      selfDeclared: false,
    },
    // 'login' does NOT contain 'logout' — asserts the matcher does not
    // over-match (a case-insensitive substring check must not accept this).
    checks: [{ id: 'logout', clause: 'logout' }],
    expected: 'FAIL',
  },
  {
    id: 'neg-self-declared-with-partial',
    kind: 'negative',
    claim: {
      taskId: 't12',
      summary: 'mostly done',
      evidence: ['implemented login()'],
      selfDeclared: true,
    },
    // Evidence is non-empty (so the self-declared-empty rule does NOT fire)
    // but misses the 'tests' clause → FAIL with the 'tests' reason.
    checks: [
      { id: 'login', clause: 'login' },
      { id: 'tests', clause: 'auth tests' },
    ],
    expected: 'FAIL',
  },
]

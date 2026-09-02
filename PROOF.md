# PROOF — Machine-Checked Invariants

The measurement in the paper reads an append-only log because the harness is
built to keep one. Three invariants are load-bearing, and each is machine-checked
by suites in this repository: the frozen-projection (golden rule) suite, the
host type build, lint, and the feature gate suites. This file records what
those checks cover and the counts they assert.

Every number below is real vitest/tsc/oxlint output captured with
`pnpm run test:golden-rule`, `pnpm vitest run <specs>`, `pnpm exec tsc -b
tsconfig.host.json`, and `pnpm exec oxlint`. Zero fabricated numbers.

## 1. Golden rule still holds — frozen-projection suite green

`pnpm run test:golden-rule` → 3 test files, 9 tests, ALL PASSED (1.62s):

| Spec file | Tests | Result |
|---|---|---|
| packages/core/session/tests/golden-rule.spec.ts | 5 | PASS |
| packages/llm/llm-deepseek/tests/golden-rule.spec.ts | 2 | PASS |
| packages/llm/llm-pi-ai/tests/golden-rule.spec.ts | 2 | PASS |

Output: `Test Files 3 passed (3)  Tests 9 passed (9)`.

## 2. No regression on the corrected baseline

- Host type build: `pnpm exec tsc -b tsconfig.host.json` → rc=0 (clean, no output).
- Lint on all touched feature packages (src + tests, 43 files): `pnpm exec
  oxlint` → 0 warnings, 0 errors.
- Feature suites (below) all green at the same counts as their landing commits:
  judge 9/9, context-debt 7/7, budget-router 9/9, lane-guard 10/10,
  observability 15/15.

## 3. New gates fire on known-bad input (real test output)

`pnpm vitest run --reporter=verbose <5 feature specs>` → 5 files, 50 tests,
ALL PASSED (3.09s). The known-bad demonstrations, by gate:

### 3.1 Panel rejects a non-decomposed plan (judge panel)
Input: non-decomposed plan fixture (no decomposition carried by the plan).
- `unanimity not averaging: one NO on a non-decomposed fixture → REPLAN` PASS
  (a single NO is a veto, not an average; judge/replan event emitted).
- `bounded replan loop: repeated NO exhausts budget → ESCALATE` PASS.
- `completion gate: unapproved plan → NO, approved plan with evidence → PASS`
  PASS.

### 3.2 Budget stops an over-budget run (budget-router)
Input: accounting credits=100, budgets.default=100, usage chunks that exceed.
- `over-budget run stops at the budget` PASS — spendFor('default') == 100,
  budget/veto event recorded, the inner over-budget call never executes.
- `cumulative cost conditioning switches tiers` PASS.
- `frozen requests degrade to advisory, never mutate` PASS — a frozen request
  is never mutated (golden-rule adjacency).

### 3.3 Injection payload fails at the tool gate (lane-guard)
Input: the 22-payload injection fixture set (empirical Pass 6 set).
- `22-payload fixture: >=19/22 resisted at the tool gate` PASS — exactly 19
  resisted; the 3 non-resistant are the documented in-band ceiling
  (in-band-summary, in-band-fact, in-band-lie), asserted by id.
- All 12 of 22 payloads carrying a directedTool are vetoed at the gate.
- `in-band class blocked by the allowlist` PASS; `allowlist denies a non-listed
  tool at the real guard boundary` PASS; `sanitize strips injected prompts
  pre-context` PASS; `taint verification flags untraced clauses` PASS.

### 3.4 Observability TNR gate + predictive signals (observability)
Input: 12 verifier fixtures (6 positive, 6 negative) + known-bad event streams.
- `TNR gate: negative-fixture TNR >= 0.8` PASS — TNR=1.0, TPR=1.0 (positives
  6, negatives 6; gate asserts TNR/TPR >= 0.8).
- `self-declared completion rejected` PASS — completion owned by the verifier;
  a self-declared completion without evidence is rejected.
- Signals fire on bad streams, stay CLEAR on healthy: `P-Ratio alarm on
  plan-heavy stream` PASS, `E→V deficit warn on verify-light stream` PASS,
  `P-X-P spiral alarm` PASS, `repeated-call alarm` PASS, `healthy stream is
  CLEAR` PASS.

## 4. Golden rule held inside every new package

The new packages carry their own append-only assertions, all PASS:
- context-debt: `fold-only compaction plan leaves the log byte-identical`
  PASS — scan/plan/report/reposition through the REAL
  JsonlSessionPersistence leave session.jsonl byte-identical (append-only
  held, never a rewrite).
- observability: `golden rule: inputs byte-identical + buffer not retained by
  reference` PASS — the ring buffer is a derived projection; inputs are
  deep-frozen, never aliased.
- lane-guard: `golden rule: inputs byte-identical` PASS.
- budget-router: `routing preserves prefix-cache-friendly history` PASS —
  request prefix unchanged across stage routing (120x cache economics intact).

## 5. Summary

| Gate | Known-bad input | Result |
|---|---|---|
| Golden rule (frozen projections) | deliberate mutation fixtures | 9/9 PASS |
| Host build / lint regression | whole host graph | tsc rc=0, oxlint 0/0 |
| Panel veto | non-decomposed plan | REPLAN/NO, unanimity held |
| Budget stop | over-budget usage | stopped at budget, veto emitted |
| Tool-gate injection defense | 22-payload set | 19/22 resisted, in-band blocked |
| Verifier TNR | 6+6 pos/neg fixtures | TNR=1.0, TPR=1.0, gate >=0.8 |
| Completion ownership | self-declared completion | rejected |
| Predictive signals | bad streams vs healthy | 4/4 alarm kinds fire, CLEAR on healthy |
| Append-only in new packages | scan/plan/report/reposition | JSONL byte-identical |

All inputs cited by the paper's verification section are real numbers from the
runs above.

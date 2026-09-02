/**
 * Self-targeted tests for the bench contract pre-flight.
 *
 * The rv-28 contract-cliff shape is the unit test: a batch's DOCSTRING IS THE
 * CONTRACT (imperative clauses, including the binding error clause — `raise
 * ValueError when size <= 0`), and the visible test only asserts the happy
 * path. The §4.2 rule must: extract the imperative clauses, emit them as a
 * checklist, and at close diff the checklist against the visible tests and
 * surface the error clause as UNCOVERED — the exact gap that made rv-28 a
 * loop runway without the pre-flight.
 *
 * Verifies (self-targeted fast spec — deferred-verification contract):
 * 1. The bench PRESET (home patch) composes the `bench-pre-execute` row when
 *    contract + tests paths are configured (writeHomePatch is arm-agnostic).
 * 2. extractImperativeClauses pulls imperative clauses from a docstring,
 *    including the error clauses, dropping the leading bullet.
 * 3. buildContractChecklist renders a flat numbered model-readable block.
 * 4. diffChecklistCoverage flags the error clause UNCOVERED (happy-path tests
 *    never mention it) and marks it covered once a test names it.
 * 5. appendPreFlightDirective appends to a NEW result (input untouched) and
 *    leaves the result unchanged when no clauses were found.
 *
 * @module @contracts/dsh-bench/pre-execute.spec
 */

import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendPreFlightDirective,
  buildContractChecklist,
  diffChecklistCoverage,
  extractImperativeClauses,
  readContractAndDiff,
  renderCoverageDiff,
  writeHomePatch,
} from '../src/index.ts'
import type { ContractChecklist, GuardToolResult } from '../src/index.ts'

/** The rv-28 batches docstring contract (binding; error clauses). */
const RV28_DOCSTRING = [
  'Split "total" into batches of at most "size" elements.',
  '',
  'Args:',
  '    total: The total number of elements to split.',
  '    size: The maximum number of elements per batch.',
  '',
  'Returns:',
  '    A list of batches; each batch has at most "size" elements.',
  '',
  'Raises:',
  '- ValueError if size <= 0.',
  '- TypeError if a non-integer is passed.',
].join('\n')

/** The rv-28 visible-test source: happy path ONLY (never the error). */
const RV28_HAPPY_TESTS = `
import sys
sys.path.insert(0, ".")  # noqa
from batches import batches

def test_even():
    assert batches(6, 3) == [3, 3]

def test_remainder():
    assert batches(7, 3) == [3, 3, 1]

def test_single():
    assert batches(2, 5) == [2]
`.trim()

function rv28Checklist(): ContractChecklist {
  return extractImperativeClauses(RV28_DOCSTRING)
}

describe('bench preset pre-execute composition (T3)', () => {
  it('emits the bench-pre-execute row when contract+tests paths are configured', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-pre-exec-patch-'))
    try {
      const patch = writeHomePatch(
        home,
        { model: 'm', temperature: 0, maxTokens: 8192 },
        undefined,
        undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined,
        undefined, undefined,
        { contractPath: 'repo/batches.py', testsPath: 'repo/tests/test_batches.py' },
      )
      expect(patch).toContain('bench-pre-execute')
      expect(patch).toContain('"contractPath":"repo/batches.py"')
      expect(patch).toContain('"testsPath":"repo/tests/test_batches.py"')
      expect(existsSync(join(home, 'cordis.patch.yml'))).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('extractImperativeClauses (docstring contract)', () => {
  it('extracts the imperative clauses, including the error clauses', () => {
    const checklist = rv28Checklist()
    expect(checklist.found).toBe(true)
    const texts = checklist.clauses.map(clause => clause.text)
    expect(texts.some(text => /ValueError/.test(text))).toBe(true)
    expect(texts.some(text => /size <= 0/.test(text))).toBe(true)
    expect(texts.some(text => /TypeError/.test(text))).toBe(true)
  })

  it('drops the leading bullet from the error imperative clauses', () => {
    const checklist = extractImperativeClauses('- ValueError raised when size <= 0.')
    const text = checklist.clauses[0]?.text ?? ''
    expect(text.startsWith('-')).toBe(false)
    expect(text).toContain('ValueError')
  })

  it('returns found=false for an empty/non-imperative source', () => {
    expect(extractImperativeClauses('').found).toBe(false)
    expect(extractImperativeClauses('  \n  \n').found).toBe(false)
  })
})

describe('buildContractChecklist', () => {
  it('renders a flat numbered model-readable block', () => {
    const block = buildContractChecklist(rv28Checklist())
    expect(block).toContain('CONTRACT CHECKLIST (binding')
    expect(block).toContain('ValueError')
  })
})

describe('diffChecklistCoverage (the rv-28 gap)', () => {
  it('surfaces the error clause as UNCOVERED (happy-path tests never mention it)', () => {
    const diff = diffChecklistCoverage(rv28Checklist(), RV28_HAPPY_TESTS)
    expect(diff.uncovered.length).toBeGreaterThan(0)
    expect(diff.uncovered.some(clause => /ValueError/.test(clause.text))).toBe(true)
  })

  it('marks the error clause covered once a test names it', () => {
    const withErrorTest = `${RV28_HAPPY_TESTS}
def test_zero():
    with pytest.raises(ValueError):
        batches(5, 0)`
    const diff = diffChecklistCoverage(rv28Checklist(), withErrorTest)
    expect(diff.uncovered.some(clause => /ValueError/.test(clause.text))).toBe(false)
  })

  it('renderCoverageDiff renders the uncovered clauses', () => {
    const diff = diffChecklistCoverage(rv28Checklist(), RV28_HAPPY_TESTS)
    const report = renderCoverageDiff(diff)
    expect(report).toContain('CONTRACT GAP')
    expect(report).toContain('ValueError')
  })
})

describe('appendPreFlightDirective (immutability golden rule)', () => {
  it('returns a NEW result with the checklist appended, input untouched', () => {
    const original: GuardToolResult = {
      content: [{ type: 'text', text: 'original applied' }],
      isError: false,
    }
    const out = appendPreFlightDirective(original, buildContractChecklist(rv28Checklist()))
    expect(out).not.toBe(original)
    expect(original.content).toHaveLength(1)
    expect(out.content.length).toBe(2)
    expect(out.content[1]!.text).toContain('ValueError')
    expect(out.content[1]!.text).toContain('contract checklist')
  })

  it('leaves the result untouched when no clauses were found', () => {
    const original: GuardToolResult = { content: [{ type: 'text', text: 'x' }], isError: false }
    const out = appendPreFlightDirective(original, 'CONTRACT CHECKLIST: no imperative clauses found.')
    expect(out).toBe(original)
  })
})

describe('readContractAndDiff (reads + diffs from sandbox paths)', () => {
  it('reads the contract + tests files and returns the coverage diff', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'bench-pre-exec-sbx-'))
    try {
      writeFileSync(join(sandbox, 'batches.py'), RV28_DOCSTRING)
      writeFileSync(join(sandbox, 'test_batches.py'), RV28_HAPPY_TESTS)
      const { checklist, diff } = readContractAndDiff(
        join(sandbox, 'batches.py'),
        join(sandbox, 'test_batches.py'),
      )
      expect(checklist.found).toBe(true)
      expect(diff.uncovered.some(clause => /ValueError/.test(clause.text))).toBe(true)
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })
})

/**
 * Self-targeted tests for the bench mistake ledger.
 *
 * Verifies (self-targeted fast spec — deferred-verification contract, no
 * full suite run):
 * 1. The bench PRESET (home patch) composes the `bench-mistake-ledger` row
 *    when a ledger config is provided (writeHomePatch is arm-agnostic) and
 *    emits NO ledger row by default.
 * 2. The byte-stable core: ledgerRecord builds the exact one-line
 *    "ALREADY TRIED <tool>: <failure>"; pinLedgerRecord returns a NEW core
 *    and dedupes by tool (a tool is pinned once, first failure wins);
 *    renderLedgerCore is DETERMINISTIC (same set -> same bytes, insert
 *    order preserved).
 * 3. COMPACTION SURVIVAL: compactLedgerCore keeps every pinned record (the
 *    record-exemption boundary — reduction never touches records).
 * 4. GRADE-SWITCH SURVIVAL: gradeLedgerRender is byte-identical for every
 *    reduction grade label (low/med/high/xhigh) — the byte-stable core
 *    survives grade switches (paper §4.5: "the measured core ... byte-
 *    stable, so the provider prompt-cache read survives grade switches").
 * 5. The veto builder: a re-tried ledger-listed tool is an isError result
 *    carrying the pinned record text + the ALREADY_TRIED_VETOED code and
 *    the repeat directive (mirror of guard/retry-judge veto builders).
 *
 * Mirror of the guard.spec + retry-judge.spec patterns (T6/T7/T17); the
 * ledger runs the same pure-core + veto-result test shape.
 *
 * @module @atlasai/atsh-bench/mistake-ledger.spec
 */

import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_REPEAT_DIRECTIVE,
  compactLedgerCore,
  EMPTY_MISTAKE_LEDGER,
  gradeLedgerRender,
  ledgerRecord,
  mistakeLedgerVetoResult,
  pinLedgerRecord,
  renderLedgerCore,
  writeHomePatch,
} from '../src/index.ts'

const GRADES: readonly ('low' | 'med' | 'high' | 'xhigh')[] = ['low', 'med', 'high', 'xhigh']

describe('bench preset mistake-ledger composition (T18)', () => {
  it('emits the bench-mistake-ledger row when a ledger config is configured', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-ledger-patch-'))
    const patch = writeHomePatch(
      home,
      { model: 'm', temperature: 0, maxTokens: 8192 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { repeatDirectiveText: 'READ THE LEDGER and pivot.' },
    )
    expect(patch).toContain('bench-mistake-ledger')
    expect(patch).toContain('READ THE LEDGER and pivot.')
    expect(existsSync(join(home, 'cordis.patch.yml'))).toBe(true)
    expect(readFileSync(join(home, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    rmSync(home, { recursive: true, force: true })
  })

  it('emits NO mistake-ledger row by default (no ledger configured)', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-ledger-none-'))
    const patch = writeHomePatch(home, { model: 'm', temperature: 0, maxTokens: 8192 })
    expect(patch).not.toContain('bench-mistake-ledger')
    rmSync(home, { recursive: true, force: true })
  })
})

describe('bench mistake-ledger core (ledgerRecord / pinLedgerRecord / renderLedgerCore)', () => {
  it('builds the exact one-line already-tried record', () => {
    const record = ledgerRecord('bash', 'exit 1: file not found')
    expect(record).toEqual({ tool: 'bash', failure: 'exit 1: file not found' })
  })

  it('pins into a NEW core and preserves insert order', () => {
    const first = pinLedgerRecord(EMPTY_MISTAKE_LEDGER, ledgerRecord('read', 'ENOENT'))
    const second = pinLedgerRecord(first, ledgerRecord('bash', 'syntax error'))
    // Immutable: the ORIGINAL core is untouched.
    expect(first.records).toHaveLength(1)
    expect(second.records).toHaveLength(2)
    expect(second.records.map(r => r.tool)).toEqual(['read', 'bash'])
  })

  it('dedupes by tool name — the first failure stays the recorded one', () => {
    const once = pinLedgerRecord(EMPTY_MISTAKE_LEDGER, ledgerRecord('bash', 'first failure'))
    const again = pinLedgerRecord(once, ledgerRecord('bash', 'second failure'))
    expect(again.records).toHaveLength(1)
    expect(again.records[0]!.failure).toBe('first failure')
  })

  it('renders the byte-stable surface deterministically (same set -> same bytes)', () => {
    const a = pinLedgerRecord(
      pinLedgerRecord(EMPTY_MISTAKE_LEDGER, ledgerRecord('read', 'ENOENT')),
      ledgerRecord('bash', 'syntax error'),
    )
    const b = pinLedgerRecord(
      pinLedgerRecord(EMPTY_MISTAKE_LEDGER, ledgerRecord('read', 'ENOENT')),
      ledgerRecord('bash', 'syntax error'),
    )
    const text = renderLedgerCore(a)
    expect(text).toBe(renderLedgerCore(b))
    expect(text).toContain('ALREADY TRIED read: ENOENT')
    expect(text).toContain('ALREADY TRIED bash: syntax error')
  })
})

describe('bench mistake-ledger compaction survival (compactLedgerCore)', () => {
  it('keeps every pinned record across a compaction attempt', () => {
    const core = pinLedgerRecord(
      pinLedgerRecord(EMPTY_MISTAKE_LEDGER, ledgerRecord('read', 'ENOENT')),
      ledgerRecord('bash', 'syntax error'),
    )
    const after = compactLedgerCore(core)
    expect(after.records).toHaveLength(core.records.length)
    expect(renderLedgerCore(after)).toBe(renderLedgerCore(core))
  })
})

describe('bench mistake-ledger grade-switch survival (gradeLedgerRender)', () => {
  it('renders the byte-stable core IDENTICALLY for every reduction grade', () => {
    const janitor = pinLedgerRecord(
      pinLedgerRecord(EMPTY_MISTAKE_LEDGER, ledgerRecord('read', 'ENOENT')),
      ledgerRecord('bash', 'syntax error'),
    )
    const renders = GRADES.map(grade => gradeLedgerRender(janitor, grade))
    for (let i = 1; i < renders.length; i += 1) {
      expect(renders[i]).toBe(renders[0])
    }
    expect(renders[0]!.length).toBeGreaterThan(0)
  })
})

describe('bench mistake-ledger re-try veto builder (mistakeLedgerVetoResult)', () => {
  it('builds an isError veto carrying the pinned record + repeat directive and code', () => {
    const core = pinLedgerRecord(EMPTY_MISTAKE_LEDGER, ledgerRecord('bash', 'syntax error'))
    const result = mistakeLedgerVetoResult(core, 'bash')
    expect(result.isError).toBe(true)
    expect(result.error?.info.code).toBe('ALREADY_TRIED_VETOED')
    expect(result.error?.info.name).toBe('AlreadyTriedVetoedError')
    expect(result.content[0]?.text).toContain('ALREADY TRIED bash: syntax error')
    expect(result.content[0]?.text).toContain(DEFAULT_REPEAT_DIRECTIVE)
    expect(result.error?.message).toContain('bash')
  })

  it('honors a custom repeat directive', () => {
    const core = pinLedgerRecord(EMPTY_MISTAKE_LEDGER, ledgerRecord('bash', 'syntax error'))
    const custom = 'STOP. You recorded this failure already.'
    const result = mistakeLedgerVetoResult(core, 'bash', custom)
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain(custom)
    expect(result.content[0]?.text).not.toContain(DEFAULT_REPEAT_DIRECTIVE)
  })
})

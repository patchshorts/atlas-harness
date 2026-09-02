/**
 * Self-targeted tests for the bench failure-signature memory.
 *
 * Verifies (self-targeted fast spec — deferred-verification contract, no
 * full suite run):
 * 1. The bench PRESET (home patch) composes the `bench-failure-memory` row
 *    when a failure-memory config is provided (writeHomePatch is
 *    arm-agnostic) and emits NO failure-memory row by default.
 * 2. The normalised 4-field signature: failureSignature builds the canonical
 *    `tool|error|target|clause` key, case/whitespace normalised, so two calls
 *    with the same fields yield the same key and differing targets differ.
 * 3. The store: recordFailure returns a NEW store, dedupes by exact
 *    signature (first failure wins), preserves insertion order, and the
 *    ORIGINAL store is untouched (immutable).
 * 4. The pre-call same-signature check: checkSameSignature returns the key
 *    for a re-issued tool+target (error code excluded pre-call), returns
 *    undefined for a fresh signature, and does NOT match when the target
 *    differs (no false-positive veto).
 * 5. targetPathOf best-effort extracts the target path from tool args.
 * 6. The veto builder: a repeated same-signature call yields an isError
 *    result carrying the recorded failure + the SAME_SIGNATURE_VETOED code
 *    + the pivot directive (mirror of the ledger/guard veto builders).
 *
 * Mirror of the mistake-ledger.spec pattern — pure-core +
 * veto-result test shape.
 *
 * @module @atlasai/atsh-bench/failure-memory.spec
 */

import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SAME_SIGNATURE_DIRECTIVE,
  EMPTY_FAILURE_MEMORY,
  failureMemoryVetoResult,
  failureSignature,
  checkSameSignature,
  recordFailure,
  targetPathOf,
  writeHomePatch,
} from '../src/index.ts'

describe('bench preset failure-memory composition (T4)', () => {
  it('emits the bench-failure-memory row when a failure-memory config is configured', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-fm-patch-'))
    const patch = writeHomePatch(
      home,
      { model: 'm', temperature: 0, maxTokens: 8192 },
      undefined, // pinPlugin
      undefined, // guard
      undefined, // guardPlugin
      undefined, // trace
      undefined, // tracePlugin
      undefined, // verify
      undefined, // verifyPlugin
      undefined, // tripwire
      undefined, // tripwirePlugin
      undefined, // retryJudge
      undefined, // retryJudgePlugin
      undefined, // ledger
      undefined, // ledgerPlugin
      undefined, // preExecute
      undefined, // preExecutePlugin
      { repeatDirectiveText: 'READ the failure memory and pivot.' }, // failureMemory
    )
    expect(patch).toContain('bench-failure-memory')
    expect(patch).toContain('READ the failure memory and pivot.')
    expect(existsSync(join(home, 'cordis.patch.yml'))).toBe(true)
    expect(readFileSync(join(home, 'cordis.patch.yml'), 'utf8')).toBe(patch)
    rmSync(home, { recursive: true, force: true })
  })

  it('emits NO failure-memory row by default (no failure-memory configured)', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-fm-none-'))
    const patch = writeHomePatch(home, { model: 'm', temperature: 0, maxTokens: 8192 })
    expect(patch).not.toContain('bench-failure-memory')
    rmSync(home, { recursive: true, force: true })
  })
})

describe('bench failure-signature core (failureSignature)', () => {
  it('builds a canonical tool|error|target|clause key', () => {
    expect(failureSignature('edit', 'EACCES', 'src/app.ts', 'raise on empty'))
      .toBe('edit|eacces|src/app.ts|raise on empty')
  })

  it('normalises case + whitespace so the same call yields the same key', () => {
    expect(failureSignature('Edit', ' e100 ', '  src/app.ts ', 'Raise On Empty'))
      .toBe(failureSignature('edit', 'e100', 'src/app.ts', 'raise on empty'))
  })

  it('differs when the target differs (given a failure is per-target)', () => {
    const a = failureSignature('bash', 'E2', '/app/src/a.ts', '')
    const b = failureSignature('bash', 'E2', '/app/src/b.ts', '')
    expect(a).not.toBe(b)
  })
})

describe('bench failure-memory store (recordFailure)', () => {
  it('returns a NEW store and preserves insertion order', () => {
    const first = recordFailure(EMPTY_FAILURE_MEMORY, {
      tool: 'edit', errorCode: 'E100', targetPath: 'a.ts', clause: '', failure: 'boom',
    })
    const second = recordFailure(first, {
      tool: 'bash', errorCode: 'E2', targetPath: 'b.ts', clause: '', failure: 'syntax',
    })
    // Immutable: the ORIGINAL store is untouched.
    expect(first.bySignature.size).toBe(1)
    expect(second.bySignature.size).toBe(2)
    expect([...second.bySignature.values()].map(r => r.tool)).toEqual(['edit', 'bash'])
  })

  it('dedupes by exact signature — the first failure stays recorded', () => {
    const once = recordFailure(EMPTY_FAILURE_MEMORY, {
      tool: 'read', errorCode: 'ENOENT', targetPath: 'x', clause: '', failure: 'first',
    })
    const again = recordFailure(once, {
      tool: 'read', errorCode: 'ENOENT', targetPath: 'x', clause: '', failure: 'second',
    })
    expect(again === once).toBe(true) // identical signature -> no new record
    expect([...again.bySignature.values()][0]!.failure).toBe('first')
  })
})

describe('bench failure-memory pre-call check (checkSameSignature)', () => {
  it('matches a re-issued tool at the same target (error excluded pre-call)', () => {
    const store = recordFailure(EMPTY_FAILURE_MEMORY, {
      tool: 'edit', errorCode: 'E100', targetPath: 'src/app.ts', clause: '', failure: 'boom',
    })
    expect(checkSameSignature(store, 'edit', 'src/app.ts', '')).toBe('edit|e100|src/app.ts|')
  })

  it('is undefined for a fresh signature (no false-positive veto)', () => {
    const store = recordFailure(EMPTY_FAILURE_MEMORY, {
      tool: 'edit', errorCode: 'E100', targetPath: 'src/app.ts', clause: '', failure: 'boom',
    })
    expect(checkSameSignature(store, 'edit', 'src/other.ts', '')).toBeUndefined()
    expect(checkSameSignature(store, 'bash', 'src/app.ts', '')).toBeUndefined()
  })

  it('can pin to a specific recorded error code', () => {
    const store = recordFailure(EMPTY_FAILURE_MEMORY, {
      tool: 'edit', errorCode: 'E100', targetPath: 'a.ts', clause: '', failure: 'boom',
    })
    expect(checkSameSignature(store, 'edit', 'a.ts', '', 'E100')).toBe('edit|e100|a.ts|')
    expect(checkSameSignature(store, 'edit', 'a.ts', '', 'E999')).toBeUndefined()
  })
})

describe('bench failure-memory target path extraction + veto builder', () => {
  it('targetPathOf extracts the target from tool args (best effort)', () => {
    expect(targetPathOf({ path: 'src/app.ts' })).toBe('src/app.ts')
    expect(targetPathOf({ file: '/tmp/x.ts' })).toBe('/tmp/x.ts')
    expect(targetPathOf({ other: 1 })).toBe('')
    expect(targetPathOf(undefined)).toBe('')
  })

  it('veto builder embeds the recorded failure + directive on an isError result', () => {
    const record = {
      tool: 'edit', errorCode: 'E100', targetPath: 'src/app.ts', clause: '', failure: 'boom',
    }
    const result = failureMemoryVetoResult(record)
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('SAME_SIGNATURE_VETOED')
    const text = result.content[0]!.text
    expect(text).toContain('FAILED edit: boom')
    expect(text).toContain(DEFAULT_SAME_SIGNATURE_DIRECTIVE)
    // a custom directive overrides the built-in
    const custom = failureMemoryVetoResult(record, 'PIVOT COMPLETELY.')
    expect(custom.content[0]!.text).toContain('PIVOT COMPLETELY.')
  })
})

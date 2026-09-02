/**
 * Self-targeted tests for the bench stale-knowledge verify-required bit
 *.
 *
 * Verifies (self-targeted fast spec — deferred-verification contract, no
 * full bench boot):
 * 1. The pure classifier {@link staleVerifyVerdict} marks a stale-knowledge
 *    task prompt (res-2 shape: "First verify the ACTUAL installed pydantic
 *    version …") as verification-required, and a plain re-run prompt (no
 *    verify/current-version/actual-installed) as NOT required (cache stays).
 * 2. The forced purpose differs from the run default, i.e. the harness
 *    llm-cache exactHash (which keys on `purpose`) produces a non-colliding
 *    key → guaranteed cache miss → live upstream read. We prove the KEY
 *    CHANGES by hashing the exactHash canonical subset with the default vs
 *    forced purpose.
 * 3. The bench PRESET (home patch) composes the `bench-verify-required` row
 *    when a prompt is supplied (writeHomePatch, arm-agnostic), and is absent
 *    by default.
 *
 * @module @atlasai/atsh-bench/verify.spec
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  staleVerifyVerdict,
  VERIFICATION_REQUIRED_PURPOSE,
  writeHomePatch,
} from '../src/index.ts'

/** Canonical cache-key subset the harness llm-cache exactHash keys on
 *  (dsh-cache service). Purpose is one of the keyed fields. */
function cacheKey(purpose: string): string {
  const canonical = {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    purpose,
    system: 'sys',
    temperature: 0,
    messages: [{ role: 'user', content: 'First verify the ACTUAL installed pydantic version, then migrate.' }],
    tools: [],
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

describe('stale-knowledge verify-required classifier (T9)', () => {
  it('marks a verify-first task prompt as verification-required', () => {
    const verdict = staleVerifyVerdict(
      'First verify the ACTUAL installed pydantic version and its validator semantics, then migrate legacy.py.',
    )
    expect(verdict.verificationRequired).toBe(true)
    expect(verdict.matched).toContain('verify')
    expect(verdict.matched).toContain('actual installed')
    expect(verdict.forcedPurpose).toBe(VERIFICATION_REQUIRED_PURPOSE)
  })

  it('does NOT mark a plain task prompt (cache stays)', () => {
    const verdict = staleVerifyVerdict('Refactor the report generator to add a new endpoint.')
    expect(verdict.verificationRequired).toBe(false)
    expect(verdict.matched).toHaveLength(0)
    expect(verdict.forcedPurpose).toBeNull()
  })

  it('is case-insensitive over the pattern list', () => {
    const verdict = staleVerifyVerdict('Please VERIFY the CURRENT VERSION of the runtime first.')
    expect(verdict.verificationRequired).toBe(true)
    expect(verdict.matched).toEqual(expect.arrayContaining(['verify', 'current version']))
  })
})

describe('forced purpose changes the llm-cache key (T9)', () => {
  it('the verification purpose yields a DIFFERENT cache key than the default', () => {
    const defaultKey = cacheKey('')
    const forcedKey = cacheKey(VERIFICATION_REQUIRED_PURPOSE)
    expect(forcedKey).not.toBe(defaultKey)
    // A distinct key is a guaranteed cache MISS against the default-priced rows.
    expect(forcedKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('the pure classifier returns the distinct purpose exactly when required', () => {
    const required = staleVerifyVerdict('First verify the actual installed version.')
    const plain = staleVerifyVerdict('Add a new route.')
    expect(required.forcedPurpose).toBe(VERIFICATION_REQUIRED_PURPOSE)
    expect(plain.forcedPurpose).toBeNull()
  })
})

describe('bench preset verify-required composition (T9)', () => {
  it('emits the bench-verify-required row when a prompt is configured', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-verify-patch-'))
    const patch = writeHomePatch(
      home,
      { model: 'm', temperature: 0, maxTokens: 8192 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { prompt: 'First verify the ACTUAL installed pydantic version, then migrate.' },
    )
    expect(patch).toContain('bench-verify-required')
    expect(patch).toContain('First verify the ACTUAL installed pydantic version, then migrate.')
    expect(patch).toContain('bench-pin-request')
    expect(existsSync(join(home, 'cordis.patch.yml'))).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })

  it('does NOT emit the verify row by default (no verify config)', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-verify-none-'))
    const patch = writeHomePatch(home, { model: 'm', temperature: 0, maxTokens: 8192 })
    expect(patch).not.toContain('bench-verify-required')
    rmSync(home, { recursive: true, force: true })
  })

  it('verify row carries the patterns + purpose overrides when supplied', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-verify-ovr-'))
    const patch = writeHomePatch(
      home,
      { model: 'm', temperature: 0, maxTokens: 8192 },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { prompt: 'check the version', patterns: ['check'], verificationPurpose: 'custom-verify' },
    )
    expect(patch).toContain('custom-verify')
    expect(patch).toContain('["check"]')
    rmSync(home, { recursive: true, force: true })
  })
})

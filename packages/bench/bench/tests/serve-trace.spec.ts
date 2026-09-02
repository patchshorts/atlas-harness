/**
 * Self-targeted tests for the bench serve-trace short-circuit classifier.
 *
 * Verifies (self-targeted fast spec — deferred-verification contract, no full bench
 * boot):
 * 1. The bench PRESET (home patch) composes the `bench-serve-trace` row when a
 *    sidecar path is supplied — the tracer is ACTIVE in the session composition
 *    for both arms (writeHomePatch is arm-agnostic), and absent by default.
 * 2. The pure classifier NAMES the short-circuiting subsystem on the res-2
 *    "verify installed version first" step:
 *    - `cache` — a completion served from the harness response cache precedes any
 *      live verify tool → names `cache`.
 *    - `router` — a router-rewritten completion precedes any live verify tool →
 *      names `router`.
 *    - `live` — the model ran a verify tool (e.g. `bash python -c
 *      "import pydantic; print(version)") before migrating → no short-circuit.
 * 3. Serve-trace sidecar JSONL round-trips (append → read back verbatim).
 *
 * @module @atlasai/atsh-bench/serve-trace.spec
 */

import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendServeTrace,
  readServeTrace,
  shortCircuitVerdict,
  writeHomePatch,
} from '../src/index.ts'
import type { ServeRecord } from '../src/index.ts'

describe('bench preset serve-trace composition (T8)', () => {
  it('emits the bench-serve-trace row when a sidecar path is configured', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-trace-patch-'))
    const patch = writeHomePatch(
      home,
      { model: 'm', temperature: 0, maxTokens: 8192 },
      undefined,
      undefined,
      undefined,
      { path: '/tmp/bench-trace/serve.jsonl' },
    )
    expect(patch).toContain('bench-serve-trace')
    expect(patch).toContain('/tmp/bench-trace/serve.jsonl')
    expect(patch).toContain('bench-pin-request')
    expect(existsSync(join(home, 'cordis.patch.yml'))).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })

  it('does NOT emit the trace row by default (no trace config)', () => {
    const home = mkdtempSync(join(tmpdir(), 'bench-trace-none-'))
    const patch = writeHomePatch(home, { model: 'm', temperature: 0, maxTokens: 8192 })
    expect(patch).not.toContain('bench-serve-trace')
    rmSync(home, { recursive: true, force: true })
  })
})

describe('serve-trace pure classifier names the short-circuiting subsystem (T8)', () => {
  it('names cache when a cached completion precedes the live verify tool', () => {
    const records: ServeRecord[] = [
      { seq: 1, source: 'live' }, // system/agent boot
      { seq: 2, source: 'cache' }, // cached completion "pydantic 2.x is fine" — no upstream
      { seq: 3, tool: 'edit' }, // migrate straight from the cached claim
    ]
    const verdict = shortCircuitVerdict(records)
    expect(verdict.shortCircuit).toBe('cache')
    expect(verdict.verifyRan).toBe(false)
    expect(verdict.note).toContain('cache')
  })

  it('names router when a router-rewritten completion precedes the live verify tool', () => {
    const records: ServeRecord[] = [
      { seq: 1, source: 'live' },
      { seq: 2, source: 'router' }, // route rewrite for the verify request
      { seq: 3, tool: 'write' }, // migrate without a real version check tool
    ]
    const verdict = shortCircuitVerdict(records)
    expect(verdict.shortCircuit).toBe('router')
    expect(verdict.verifyRan).toBe(false)
    expect(verdict.note).toContain('router')
  })

  it('reports NO short-circuit when a live verify tool ran first (the real res-2 shape)', () => {
    const records: ServeRecord[] = [
      { seq: 1, source: 'live' },
      { seq: 2, tool: 'bash' }, // python -c "import pydantic; print(__version__)" → 2.9.2
      { seq: 3, tool: 'write' }, // migrate with the verified version in hand
    ]
    const verdict = shortCircuitVerdict(records)
    expect(verdict.shortCircuit).toBeNull()
    expect(verdict.verifyRan).toBe(true)
    expect(verdict.note).toContain('no short-circuit')
  })
})

describe('serve-trace sidecar JSONL round-trip (T8)', () => {
  it('persists and reads back records verbatim', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bench-trace-rw-')), 'serve.jsonl')
    const records: ServeRecord[] = [
      { seq: 1, ts: 1786923600000, source: 'live' },
      { seq: 2, ts: 1786923600001, source: 'cache' },
      { seq: 3, ts: 1786923600002, tool: 'bash' },
    ]
    appendServeTrace(path, records)
    expect(readFileSync(path, 'utf8').split('\n').filter(l => l.trim().length > 0)).toHaveLength(3)
    const read = readServeTrace(path)
    expect(read).toEqual(records)
    // Missing file → empty, never throws.
    expect(readServeTrace(join(mkdtempSync(join(tmpdir(), 'bench-trace-miss-')), 'nope.jsonl'))).toEqual([])
    rmSync(dirnameOf(path), { recursive: true, force: true })
  })
})

function dirnameOf(p: string): string {
  return p.slice(0, p.lastIndexOf('/'))
}

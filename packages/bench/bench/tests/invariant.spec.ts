/**
 * Invariant companion test for `@atlasai/atsh-bench` — the package-owned
 * empty companion registers against the invariants registry (mirrors the
 * session-log-export invariant test shape).
 *
 * @module @atlasai/atsh-bench/invariant.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/invariant.ts'

describe('@atlasai/atsh-bench/invariant', () => {
  it('registers the package-owned empty companion', async () => {
    const register = vi.fn(() => vi.fn())
    const ctx = new Context()
    ctx.provide('invariants', { register })
    const dispose = await apply(ctx)
    expect(name).toBe('bench-invariant')
    expect(inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@atlasai/atsh-bench', expect.any(Function))
    dispose()
  })
})

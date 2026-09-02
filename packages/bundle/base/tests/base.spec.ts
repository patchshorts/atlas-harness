/**
 * The bundle's substance is its patch file: the `atsh.bundle.patch` manifest
 * field must name a real, parseable patch list.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'

describe('dsh-base bundle', () => {
  it('declares a parseable patch list through the atsh.bundle.patch manifest field', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      atsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.atsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.atsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    // The base layer is one insert list over the empty profile root.
    const rows = (parsed as { insert?: { id?: string; config?: Record<string, unknown> }[] }[]).flatMap(
      patch => patch.insert ?? [],
    )
    expect(rows.length).toBeGreaterThan(50)
    expect(rows.some(row => row.id === 'agent-loop')).toBe(true)
    expect(rows.find(row => row.id === 'session-telemetry-otel')?.config?.['mode']).toEqual({
      __jsExpr: "process.env.ATSH_TELEMETRY_MODE || 'DISABLED'",
    })
    expect(rows.filter(row => row.id === 'subagent-codex')).toHaveLength(0)
    expect(rows.filter(row => row.id === 'subagent-claude-code')).toHaveLength(0)
    expect(manifest.dependencies).not.toHaveProperty('@atlasai/atsh-subagent-codex')
    expect(manifest.dependencies).not.toHaveProperty('@atlasai/atsh-subagent-claude-code')
  })

  it('mounts the prompt-lume reducer suite host-plane as DEFAULT', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('base patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: { id?: string; name?: string; inject?: string[]; config?: Record<string, unknown> }[] }).insert ?? []
        : [],
    )
    // The four-row reducer suite lives in base (host plane), not a preset — its
    // listeners (system-prompt/assemble, agent/pre-step) fire on host emits,
    // and a preset isolate realm would never see them. That base is the shared
    // core every surface composes (headless = base+headless, web = base+web-app)
    // is what makes DEFAULT-ON hold for standard + cli + headless alike.
    for (const id of ['prompt-corpus', 'prompt-lume', 'prompt-context-trim', 'prompt-lume-prime']) {
      const row = rows.find(candidate => candidate.id === id) as
        | { id?: string; name?: string; inject?: string[]; config?: Record<string, unknown> }
        | undefined
      if (row === undefined) throw new Error(`base patch must mount ${id}`)
      if (row.name === undefined) throw new Error(`${id} must name its plugin`)
      expect(row.name.startsWith('@atlasai/atsh-'), `${id} plugin name`).toBe(true)
    }
    // Order is load-significant: corpus defines ctx.promptCorpus before lume
    // injects it; prime (which injects promptCorpus + promptLume) is last.
    const corpus = rows.findIndex(row => row.id === 'prompt-corpus')
    const lume = rows.findIndex(row => row.id === 'prompt-lume')
    const prime = rows.findIndex(row => row.id === 'prompt-lume-prime')
    expect(corpus).toBeGreaterThanOrEqual(0)
    expect(lume).toBeGreaterThan(corpus)
    expect(prime).toBeGreaterThan(lume)
    const primeRow = rows.find(row => row.id === 'prompt-lume-prime') as { inject?: string[] }
    expect(primeRow.inject).toEqual(['promptCorpus', 'promptLume'])
    // The packages must be resolvable from the base bundle's own deps.
    expect(manifest.dependencies).toHaveProperty('@atlasai/atsh-prompt-corpus')
    expect(manifest.dependencies).toHaveProperty('@atlasai/atsh-prompt-lume')
    expect(manifest.dependencies).toHaveProperty('@atlasai/atsh-prompt-context-trim')
  })

  it('gates each shell stack by platform with a symmetric disabled expression', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('base patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
        : [],
    )
    // Symmetric gating: each stack's executor and tool rows carry the same
    // platform fact, inverted between the bash and pwsh twins, so exactly one
    // shell stack mounts per host. Evaluate with a platform-scoped context
    // (the `with` scope shadows the global `process`) so both outcomes pin on
    // every host.
    for (const [id, win32, linux] of [
      ['bash-sandbox', true, false],
      ['tool-bash', true, false],
      ['pwsh-sandbox', false, true],
      ['tool-pwsh', false, true],
    ] as const) {
      const row = rows.find(candidate => candidate.id === id)
      if (row === undefined) throw new Error(`base patch must mount ${id}`)
      const expression = (row.disabled as { __jsExpr?: string } | undefined)?.__jsExpr
      if (expression === undefined) throw new Error(`${id} must gate on a !!js disabled expression`)
      expect(Boolean(evaluate({ process: { platform: 'win32' } }, expression)), `${id} on win32`).toBe(win32)
      expect(Boolean(evaluate({ process: { platform: 'linux' } }, expression)), `${id} on linux`).toBe(linux)
    }
    // The platform layer folded into these rows: no separate patch file ships.
    expect(existsSync(resolve(root, 'windows.cordis.patch.yml'))).toBe(false)
  })
})

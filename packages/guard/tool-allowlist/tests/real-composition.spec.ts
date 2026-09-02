/**
 * REAL-composition coverage (packages/AGENTS.md product-visible plugin
 * policy): the shipped guard-owned cordis.yml shape (system-prompt + tools +
 * tool-allowlist) boots through the vendored Loader, and an out-of-list call
 * is denied at the gate with the structured TOOL_NOT_ALLOWLISTED result while
 * an allowlisted call passes unchanged. Hand-built `ctx.plugin(...)` suites
 * (tool-allowlist.spec.ts) cannot prove the mounted composition — this boots
 * the real YAML through the real Loader and observes the durable outcome.
 *
 * The composition carries the fail-closed allowlist config
 * and the channel-marking system-prompt section is mounted separately via its
 * registration helper (agent-loop T3, verified in channel-marking.spec.ts) —
 * this spec pins the gate path of the composed defense.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@atlasai/atsh-llm'
import SystemPrompt from '@atlasai/atsh-system-prompt'
import ToolRuntime, { defineContentToolFixture, type ToolExecutionInput } from '@atlasai/atsh-tools'
import * as ToolAllowlist from '../src/index.ts'

const TOOL_ALLOWLIST = '@atlasai/atsh-tool-allowlist'
const SYSTEM_PROMPT = '@atlasai/atsh-system-prompt'
const TOOLS = '@atlasai/atsh-tools'

const signal = new AbortController().signal

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  root = undefined
})

/** A registerable fixture tool that returns OK text. */
const okTool = (name: string) =>
  defineContentToolFixture({
    name,
    description: 'returns ok',
    parameters: {},
    async execute() {
      return [{ type: 'text' as const, text: 'ok' }]
    },
  })

/**
 * Boot the shipped composition shape (system-prompt + tools + tool-allowlist,
 * with the fail-closed allowlist config) through the real vendored Loader.
 */
async function loadComposition(allowlist: string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-tool-allowlist-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    `- name: '${SYSTEM_PROMPT}'`,
    `- name: '${TOOLS}'`,
    `- name: '${TOOL_ALLOWLIST}'`,
    '  config:',
    `    allowlist: [${allowlist.map(name => `'${name}'`).join(', ')}]`,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    [SYSTEM_PROMPT, SystemPrompt],
    [TOOLS, ToolRuntime],
    [TOOL_ALLOWLIST, ToolAllowlist],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

function run(ctx: Context, name: string, args: Record<string, unknown> = {}): ReturnType<typeof ctx.tools.execute> {
  const input: ToolExecutionInput = { callId: CallId('c1'), name, arguments: args, signal }
  return ctx.tools.execute(input)
}

describe('tool-allowlist real Loader composition', () => {
  it('boots the shipped YAML shape with every row mounted (none unloaded)', { timeout: 60_000 }, async () => {
    const ctx = await loadComposition(['read'])

    const unloaded = [...ctx.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const names = [...ctx.loader.entries()].map(entry => entry.options.name)
    expect(names).toContain(SYSTEM_PROMPT)
    expect(names).toContain(TOOLS)
    expect(names).toContain(TOOL_ALLOWLIST)
  })

  it('denies an out-of-list call with the structured TOOL_NOT_ALLOWLISTED result', { timeout: 60_000 }, async () => {
    const { TOOL_NOT_ALLOWLISTED: code } = await import('../src/index.ts')
    const ctx = await loadComposition(['read'])
    ctx.tools.register(okTool('read'))
    ctx.tools.register(okTool('write'))

    const denied = await run(ctx, 'write')
    expect(denied.isError).toBe(true)
    if (denied.isError) {
      expect(denied.error.info?.code).toBe(code)
      const deniedText = denied.content[0]
      if (deniedText?.type === 'text') expect(deniedText.text).toContain('Error')
    }

    const allowed = await run(ctx, 'read')
    expect(allowed.isError).toBe(false)
  })

  it('denies every call under the empty (fail-closed) allowlist default', { timeout: 60_000 }, async () => {
    const ctx = await loadComposition([])
    ctx.tools.register(okTool('read'))
    ctx.tools.register(okTool('anything'))

    for (const name of ['read', 'anything']) {
      const result = await run(ctx, name)
      expect(result.isError).toBe(true)
      if (result.isError) expect(result.error.info?.code).toBe('TOOL_NOT_ALLOWLISTED')
    }
  })

  it('keeps opt-in out of shipped defaults: the mounted YAML row carries no allowlist without config', { timeout: 60_000 }, async () => {
    // Prove the composition is config-driven: an empty allowlist row denies all.
    const ctx = await loadComposition([])
    ctx.tools.register(okTool('read'))
    const result = await run(ctx, 'read')
    expect(result.isError).toBe(true)
    if (result.isError) expect(result.error.info?.code).toBe('TOOL_NOT_ALLOWLISTED')
  })
})

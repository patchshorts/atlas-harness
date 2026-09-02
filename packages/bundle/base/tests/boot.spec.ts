/**
 * the cost-thesis effort M1 boot integration (bundle/base, task 6): prove that composing the
 * four prompt-lume reducer services on ONE Context — memory, prompt-corpus,
 * system-prompt, prompt-lume, prompt-context-trim, prompt-lume-prime — with NO
 * profile opt-in causes `system-prompt/assemble` to fire and produce a
 * lume-generated task-aligned region with provenance + byte budget honored.
 *
 * This mirrors how the base bundle patch mounts the suite (cordis.patch.yml),
 * so it proves the host-plane DEFAULT-ON composition end-to-end.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memory from '@atlasai/atsh-memory/src/index.ts'
import SystemPrompt from '@atlasai/atsh-system-prompt'
import PromptCorpusService from '@atlasai/atsh-prompt-corpus'
import PromptContextTrimService from '@atlasai/atsh-prompt-context-trim'
import PromptLumeService from '@atlasai/atsh-prompt-lume'
import { Session, SessionId } from '@atlasai/atsh-session'
import type { SurfaceLine } from '@atlasai/atsh-prompt-context-trim'
import * as prime from '@atlasai/atsh-prompt-lume/src/prime'

const WORKSPACE_DOC = [
  '# Workspace Rules',
  '',
  'Follow AGENTS.md for this directory.',
  '',
  '## Imports',
  '',
  'Use package names across packages; never reach into a sibling private directory.',
  '',
  '## Review',
  '',
  'Land each change behind its targeted vitest spec before the merge flow advances.',
].join('\n')

const SKILLS_DOC = [
  '# Bash Skills',
  '',
  'You can run bash commands in a sandboxed shell.',
  '',
  '## Safety',
  '',
  'Never expose secrets with {{credential.name}}.',
  '',
  '## Tools',
  '',
  'Use the terminal tool for shell work.',
].join('\n')

/**
 * Seed a tiny instruction root so prime.apply() ingests a controlled, small
 * instruction set (deterministic recall) instead of the whole repo.
 */
async function seedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gaf210-boot-'))
  await writeFile(join(root, 'AGENTS.md'), '# Workspace Rules\nResolve imports through the workspace store.\n')
  return root
}

/**
 * Mount the real reducer suite on ONE context with NO profile opt-in. The
 * order is load-significant (matches cordis.patch.yml / prime.spec.ts):
 * corpus defines ctx.promptCorpus before lume injects it; prime (which
 * injects promptCorpus + promptLume) is last.
 */
async function compose(budgetBytes = 2048): Promise<{ ctx: Context; root: string }> {
  const root = await seedRoot()
  const ctx = new Context()
  await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
  await ctx.plugin(PromptCorpusService)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(PromptLumeService, { budgetBytes })
  await ctx.plugin(PromptContextTrimService)
  await ctx.plugin(prime, { enabled: true, root, maxFileBytes: 1024 * 1024 })
  return { ctx, root }
}

/**
 * One stable in-memory session per composed context, plus a drain helper that
 * reads the task-aligned region through the REAL emission path. the prior workstream moved
 * the region out of `assembly.sections` into a self-superseding tail
 * user/message, so consumers that previously read the section now drain the
 * emission. The emission supersedes its own prior wall on the SAME session,
 * so a context must pin one session object (not recreate one per drain).
 */
const bootSessions = new WeakMap<Context, Session>()
let bootSessionCounter = 0

function drainRegion(ctx: Context): string | undefined {
  let session = bootSessions.get(ctx)
  if (session === undefined) {
    bootSessionCounter += 1
    session = Session.create(SessionId(`gaf247-boot-${bootSessionCounter}`))
    bootSessions.set(ctx, session)
  }
  const lume = ctx.promptLume as unknown as { emitRegion(s: Session): { data: { content: unknown } } | undefined }
  const emitted = lume.emitRegion(session)
  if (emitted === undefined) return undefined
  const content = emitted.data.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .join('')
  }
  return ''
}

describe('prompt-lume M1 boot composition', () => {
  it('composes all four reducers on one Context; assemble fires with no opt-in and emits a provenance-labeled budgeted region', async () => {
    const { ctx, root } = await compose()
    try {
      await ctx.promptCorpus.ingest(WORKSPACE_DOC, { corpus: 'agent-instructions', scope: 'workspace' })

      ctx.promptLume.primeTurn({ intent: 'import packages across the workspace store', kind: 'workspace' })
      await ctx.systemPrompt.assemble()

      // The lume listener fired on system-prompt/assemble: a task-aligned
      // region exists — drained through the real self-superseding emission.
      const regionText = drainRegion(ctx)
      expect(regionText).toBeDefined()
      // Provenance marker labels the injected chunk(s).
      expect(regionText!).toContain('[prompt-lume]')
      // Budget honored (default 2048 from the mount config).
      expect(Buffer.byteLength(regionText!, 'utf8')).toBeLessThanOrEqual(2048)
      // The region is substantive (header + at least one chunk body).
      expect(regionText!.length).toBeGreaterThan(40)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('honors a tightened byte budget on the injected region', async () => {
    const budget = 512
    const { ctx, root } = await compose(budget)
    try {
      await ctx.promptCorpus.ingest(WORKSPACE_DOC, { corpus: 'agent-instructions', scope: 'workspace' })

      ctx.promptLume.primeTurn({ intent: 'import rules', kind: 'workspace' })
      await ctx.systemPrompt.assemble()

      const regionText = drainRegion(ctx)
      expect(regionText).toBeDefined()
      // The tightened budget is honored.
      expect(Buffer.byteLength(regionText!, 'utf8')).toBeLessThanOrEqual(budget)
      expect(regionText!).toContain('[prompt-lume]')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('mounts the context-trim service and does not break assemble', async () => {
    const { ctx, root } = await compose()
    try {
      // The trim reducer is mountable on the shared context.
      expect(ctx.promptContextTrim).toBeDefined()
      expect(typeof ctx.promptContextTrim.trim).toBe('function')

      await ctx.promptCorpus.ingest(SKILLS_DOC, { corpus: 'skills', scope: 'tooling' })
      ctx.promptLume.primeTurn({ intent: 'run a bash command', kind: 'tool' })
      await ctx.systemPrompt.assemble()

      const regionText = drainRegion(ctx)
      expect(regionText).toBeDefined()
      expect(regionText!).toContain('[prompt-lume]')
      expect(Buffer.byteLength(regionText!, 'utf8')).toBeLessThanOrEqual(2048)
      // Trim remains operational alongside the rest.
      const surface: SurfaceLine[] = [{ seq: 1, text: 'aaaa' }]
      const trimmed = ctx.promptContextTrim.trim(surface, { thresholdBytes: 8, retainFloorBytes: 2 })
      expect(['none', 'verbatim', 'summarize']).toContain(trimmed.kind)
      expect(trimmed.surface.map(line => line.text)).toEqual(['aaaa'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

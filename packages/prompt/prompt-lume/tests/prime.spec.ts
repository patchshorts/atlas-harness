import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memory from '@atlasai/atsh-memory/src/index.ts'
import * as prime from '../src/prime.ts'
import PromptCorpusService from '@atlasai/atsh-prompt-corpus'
import PromptLumeService from '../src/index.ts'

// Task 5: the seed-source extension. The primer must ingest not
// just the top-level workspace instruction files (AGENTS/CLAUDE/WORKSPACE) but
// also nested skill (SKILL.md) and persona (SOUL.md) instruction corpora, so
// the relevance-gated assembler can recall them without a separate
// registration surface. This spec proves: (1) the filename set gain, (2) the
// recursive walker's discovery, (3) real ingestion onto the corpus index.

async function seedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gaf210-prime-'))
  const skillsDir = join(root, 'skills', 'example-skill')
  await mkdirs(skillsDir)
  await mkdirs(join(root, 'persona'))
  await writeFile(join(root, 'AGENTS.md'), '# Workspace Rules\nFollow the repo conventions.\n')
  await writeFile(join(root, 'CLAUDE.md'), '# Claude Notes\nUse package imports.\n')
  await writeFile(join(skillsDir, 'SKILL.md'), '# Example Skill\nUse the terminal tool for shell work.\n')
  await writeFile(join(root, 'persona', 'SOUL.md'), '# Soul\nYou are the Atlas harness agent.\n')
  return root
}

async function mkdirs(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

////////////// (1) the contract: INSTRUCTION_FILENAMES gains the new kinds

describe('prompt-lume-prime seed-source filename contract', () => {
  it('includes AGENTS/CLAUDE/WORKSPACE plus the skill and persona corpora', () => {
    expect(prime.INSTRUCTION_FILENAMES).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      'WORKSPACE.md',
      'SKILL.md',
      'SOUL.md',
    ])
  })
})

////////////// (2) the recursive walker discovers nested skill + persona files

describe('prompt-lume-prime recursive instruction walk', () => {
  it('collects a top-level AGENTS.md plus nested skills/SKILL.md and persona/SOUL.md', async () => {
    const root = await seedRoot()
    try {
      const found = prime.collectInstructionFiles(root)

      expect(found.some(p => p.endsWith('AGENTS.md'))).toBe(true)
      expect(found.some(p => p.endsWith(join('skills', 'example-skill', 'SKILL.md')))).toBe(true)
      expect(found.some(p => p.endsWith(join('persona', 'SOUL.md')))).toBe(true)
      expect(found.filter(p => p.endsWith('SKILL.md')).length).toBeGreaterThanOrEqual(1)
      expect(found.filter(p => p.endsWith('SOUL.md')).length).toBeGreaterThanOrEqual(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('skips node_modules during the recursion (no skill install noise)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'grep210-prime-nm-'))
    const nmDir = join(root, 'node_modules', 'some-pkg')
    await mkdirs(nmDir)
    await writeFile(join(nmDir, 'SKILL.md'), '# vendor skill\nnociler\n')
    try {
      const found = prime.collectInstructionFiles(root)
      expect(found.some(p => p.includes('node_modules'))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not collect arbitrary markdown, only the instruction names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'grep210-prime-'))
    await writeFile(join(root, 'README.md'), '# readme\n')
    try {
      const found = prime.collectInstructionFiles(root)
      expect(found.length).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

////////////// (3) mount ingestion: seed corpus reaches the index on apply

describe('prompt-lume-prime mount ingestion', () => {
  async function mountWithSeed(): Promise<{ ctx: Context; tail: () => Promise<number> }> {
    const root = await seedRoot()
    const ctx = new Context()
    await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
    await ctx.plugin(PromptCorpusService)
    await ctx.plugin(PromptLumeService)
    // Namespace function plugin: apply() ingests every discovered file at mount.
    await ctx.plugin(prime, { enabled: true, root, maxFileBytes: 1024 * 1024 })

    return {
      ctx,
      tail: async () => (await ctx.promptCorpus.reflect()).total,
    }
  }

  it('ingests the seeded workspace + skill + persona files into the corpus index', async () => {
    const { tail } = await mountWithSeed()
    const total = await tail()
    // Four files seed chunks: AGENTS.md, CLAUDE.md, skills/SKILL.md, persona/SOUL.md.
    // The corpus chunker splits each document into >=1 chunk, so total reflects
    // every file's body. A zero total would mean the SKILL/SOUL files were never
    // discovered (the corruption the task guards against).
    expect(total).toBeGreaterThanOrEqual(4)
  })

  it('exposes the seeded SKILL.md body through recall (relevance-gated select)', async () => {
    const { ctx, tail } = await mountWithSeed()
    expect(await tail()).toBeGreaterThanOrEqual(4)
    const hits = await ctx.promptCorpus.recall('example skill terminal tool')
    expect(hits.some(h => h.content.includes('Example Skill'))).toBe(true)
  })
})

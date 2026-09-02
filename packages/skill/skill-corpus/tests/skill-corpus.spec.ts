import { readdir } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SkillRegistry from '@atlasai/atsh-skill'
import { CORPUS_DIR, name, inject } from '@atlasai/atsh-skill-corpus'
import * as SkillCorpus from '@atlasai/atsh-skill-corpus'

const CORPUS_SKILL_COUNT = 22

async function countSkillFiles(root: string): Promise<number> {
  let count = 0
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = `${root}/${entry.name}`
    if (entry.isDirectory()) {
      count += await countSkillFiles(path)
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      count += 1
    }
  }
  return count
}

describe('dsh-skill-corpus', () => {
  it('ships a 22-file corpus: 22 general-purpose skills, one SKILL.md each', async () => {
    expect(await countSkillFiles(CORPUS_DIR)).toBe(CORPUS_SKILL_COUNT)
  })

  it('registers the corpus provider on ctx.skills and lists every skill', async () => {
    expect(name).toBe('skill-corpus')
    expect(inject).toEqual(['skills'])
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(SkillCorpus)
    const listed = await ctx.skills.list()

    // All 22 canonical skills are scannable in the shipped corpus.
    expect(listed.length).toBe(22)
    expect(listed.every(s => s.name.length > 0 && s.description.length > 0)).toBe(true)

    const loaded = await ctx.skills.get(listed[0]!.name)
    expect(loaded?.content.length).toBeGreaterThan(0)
    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })
})

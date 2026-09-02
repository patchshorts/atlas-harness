import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as memory from '@atlasai/atsh-memory/src/index.ts'
import PromptCorpusService, {
  PROMPT_NAMESPACE,
} from '../src/index.ts'

const AGENTS_DOC = [
  '# Repository Conventions',
  '',
  'Every package defaults to ESM.',
  '',
  '## Imports',
  '',
  'Use package names across packages and `.ts` in local imports.',
  '',
  '## Secrets',
  '',
  'Never commit credentials. Use {{credential.name}} in config.',
  '',
  '# Testing',
  '',
  'Match evidence to the surface. Never default to the full suite.',
].join('\n')

/** Mount the real SQLite memory backend + prompt-corpus service on a fresh context. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
  await ctx.plugin(PromptCorpusService)
  return ctx
}

describe('prompt-corpus ingest/loader service', () => {
  it('mounting the package registers ctx.promptCorpus and ingest() retains typed chunks', async () => {
    const ctx = await setup()
    expect(ctx.promptCorpus).toBeDefined()

    const result = await ctx.promptCorpus.ingest(AGENTS_DOC, { corpus: 'agent-instructions', scope: 'workspace' })
    // 1 H1 + 2 H2 under it, then a second H1 without a sub-heading = 4 chunks
    expect(result.retained).toBe(4)
    expect(result.corpus).toBe('agent-instructions')
    expect(result.scope).toBe('workspace')
    expect(result.namespace).toBe(`${PROMPT_NAMESPACE}agent-instructions`)
  })

  it('reflect() reports the retained chunk count > 0 after ingesting', async () => {
    const ctx = await setup()
    // empty store first
    const empty = await ctx.promptCorpus.reflect()
    expect(empty.total).toBe(0)

    await ctx.promptCorpus.ingest(AGENTS_DOC, { corpus: 'agent-instructions', scope: 'workspace' })
    const summary = await ctx.promptCorpus.reflect()
    expect(summary.total).toBeGreaterThan(0)
    expect(summary.total).toBe(4)
    expect(summary.byCorpus['agent-instructions']).toBe(4)
  })

  it('stores chunk metadata on every retained record (corpus/scope/specificity/cacheStability)', async () => {
    const ctx = await setup()
    await ctx.promptCorpus.ingest(AGENTS_DOC, { corpus: 'soul', scope: 'identity' })
    const summary = await ctx.memoryStore.reflect({ namespace: `${PROMPT_NAMESPACE}soul` })
    expect(summary.total).toBe(4)
    const withVar = summary.recent.find(r =>
      (r.metadata as Record<string, unknown>).cacheStable === false,
    )
    // the Secrets chunk carries a {{variable}} -> not cache-stable
    expect(withVar).toBeDefined()
    expect((withVar!.metadata as Record<string, unknown>).corpus).toBe('soul')
    expect((withVar!.metadata as Record<string, unknown>).scope).toBe('identity')
    expect((withVar!.metadata as Record<string, unknown>).specificityRank).toBeGreaterThanOrEqual(1)
  })

  it('isolates two corpora into separate namespaces', async () => {
    const ctx = await setup()
    await ctx.promptCorpus.ingest(AGENTS_DOC, { corpus: 'system', scope: '' })
    await ctx.promptCorpus.ingest(AGENTS_DOC, { corpus: 'soul', scope: 'identity' })
    const summary = await ctx.promptCorpus.reflect()
    expect(summary.total).toBe(8)
    expect(summary.byCorpus.system).toBe(4)
    expect(summary.byCorpus.soul).toBe(4)
  })

  it('empty document retains zero chunks', async () => {
    const ctx = await setup()
    const result = await ctx.promptCorpus.ingest('')
    expect(result.retained).toBe(0)
    const summary = await ctx.promptCorpus.reflect()
    expect(summary.total).toBe(0)
  })
})

describe('prompt-corpus recall router (S2)', () => {
  it('recall() returns the germane chunk first through the real lexical backend with zero embed config', async () => {
    const ctx = await setup()
    await ctx.promptCorpus.ingest(AGENTS_DOC, { corpus: 'agent-instructions', scope: 'workspace' })

    const hits = await ctx.promptCorpus.recall('how do I write local imports between packages')
    expect(hits.length).toBeGreaterThan(0)
    // the Imports section is the only chunk containing 'imports' and 'package'
    expect(hits[0]!.content).toContain('Imports')
    expect(hits[0]!.corpus).toBe('agent-instructions')
    expect(hits[0]!.namespace).toBe('prompt:agent-instructions')
    expect(hits[0]!.score).toBeGreaterThan(0)
  })

  it('recall scopes to a single corpus when corpus is named', async () => {
    const ctx = await setup()
    await ctx.promptCorpus.ingest(AGENTS_DOC, { corpus: 'agent-instructions', scope: 'workspace' })
    await ctx.promptCorpus.ingest(
      ['# Testing', '', 'Match evidence to the surface. Never default to the full suite.'].join('\n'),
      { corpus: 'skills', scope: 'ci' },
    )

    const skillsHits = await ctx.promptCorpus.recall('how should tests match evidence', { corpus: 'skills' })
    expect(skillsHits.length).toBeGreaterThan(0)
    for (const hit of skillsHits) {
      expect(hit.corpus).toBe('skills')
      expect(hit.namespace).toBe('prompt:skills')
    }
    // the germane Testing chunk is present and topical
    expect(skillsHits.some(h => h.content.includes('Testing'))).toBe(true)
  })

  it('cross-corpus recall spans all prompt corpora and keeps the corpus label per hit', async () => {
    const ctx = await setup()
    await ctx.promptCorpus.ingest(
      ['# Deploy', '', 'Ship the chart renderer to prod if the build is green.'].join('\n'),
      { corpus: 'workspace-instructions', scope: './chart-renderer' },
    )
    await ctx.promptCorpus.ingest(
      ['# Testing', '', 'Match evidence to the surface.'].join('\n'),
      { corpus: 'skills', scope: 'ci' },
    )

    const hits = await ctx.promptCorpus.recall('how do I ship the chart renderer when green')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some(h => h.corpus === 'workspace-instructions')).toBe(true)
  })
})

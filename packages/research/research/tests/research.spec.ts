/**
 * Unit coverage for @atlasai/atsh-research: disabled config short-circuits
 * both lookup paths without touching the xurl CLI or the network, the Atom
 * string-extraction parser handles a real feed sample, fetch failures degrade
 * to empty results, stats counters track successes and failures, and a
 * missing xurl binary degrades searchPosts to [] without throwing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ResearchService, { type ResearchConfig } from '../src/index.ts'

type ExecFileCallback = (
  error: (Error & { code?: string | number }) | null,
  stdout: string,
  stderr: string,
) => void
type ExecFileMock = (
  file: string,
  args: readonly string[],
  callback: ExecFileCallback,
) => void

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn<ExecFileMock>() }))

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

/** Mount the research service on a fresh context. */
async function mount(config: ResearchConfig = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ResearchService, config)
  return ctx
}

/** A three-entry Atom feed in the arXiv search-API shape. */
const SAMPLE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query: all:quantum</title>
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <published>2024-01-02T03:04:05Z</published>
    <title>Quantum teleportation with noisy channels</title>
    <summary>We study teleportation fidelity under realistic noise.</summary>
    <author><name>Alice Example</name></author>
    <author><name>Bob Sample</name></author>
    <category term="quant-ph" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.IT" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00002v2</id>
    <published>2024-01-05T10:00:00Z</published>
    <title>Gradient-free optimization at scale</title>
    <summary>A derivative-free method for large models.</summary>
    <author><name>Carol Test</name></author>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00003v1</id>
    <published>2024-01-09T12:30:00Z</published>
    <title>On the geometry of latent spaces</title>
    <summary>We characterize curvature in learned representations.</summary>
    <author><name>Dave Fixture</name></author>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`

describe('dsh-research', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('disabled config returns [] for searchPosts without invoking the xurl CLI', async () => {
    const ctx = await mount({ enabled: false })
    const posts = await ctx.research.searchPosts('anything')
    expect(posts).toEqual([])
    expect(execFileMock).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('disabled config returns [] for searchPapers without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await mount({ enabled: false })
    const papers = await ctx.research.searchPapers('anything')
    expect(papers).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('searchPapers parses a real Atom feed sample into ResearchPaper records', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      new Response(SAMPLE_ATOM, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await mount()
    const papers = await ctx.research.searchPapers('quantum')
    expect(papers).toHaveLength(3)
    expect(papers[0]?.id).toBe('2401.00001v1')
    expect(papers[0]?.title).toBe('Quantum teleportation with noisy channels')
    expect(papers[0]?.summary).toContain('teleportation fidelity')
    expect(papers[0]?.authors).toEqual(['Alice Example', 'Bob Sample'])
    expect(papers[0]?.published).toBe('2024-01-02')
    expect(papers[0]?.categories).toEqual(['quant-ph', 'cs.IT'])
    expect(papers[0]?.pdfUrl).toBe('https://arxiv.org/pdf/2401.00001v1')
    expect(papers[1]?.id).toBe('2401.00002v2')
    expect(papers[2]?.id).toBe('2401.00003v1')
    const requestedUrl = fetchMock.mock.calls[0]?.[0]
    expect(String(requestedUrl)).toContain('search_query=all:quantum')
    expect(String(requestedUrl)).toContain('max_results=10')
    await ctx.fiber.dispose()
  })

  it('fetchPaper returns null when the arXiv fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('connection refused')
    }))
    const ctx = await mount()
    const paper = await ctx.research.fetchPaper('2401.00001')
    expect(paper).toBeNull()
    await ctx.fiber.dispose()
  })

  it('getStats counts a successful paper search and a failed paper fetch', async () => {
    const fetchMock = vi.fn(async () => new Response(SAMPLE_ATOM, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await mount()
    await ctx.research.searchPapers('quantum')
    expect(ctx.research.getStats()).toEqual({
      postsSearched: 0,
      papersSearched: 1,
      papersFetched: 0,
      failures: 0,
    })
    fetchMock.mockImplementation(async () => {
      throw new TypeError('connection refused')
    })
    const paper = await ctx.research.fetchPaper('2401.00001')
    expect(paper).toBeNull()
    expect(ctx.research.getStats()).toEqual({
      postsSearched: 0,
      papersSearched: 1,
      papersFetched: 0,
      failures: 1,
    })
    await ctx.fiber.dispose()
  })

  it('searchPosts returns [] when the xurl binary is missing (ENOENT)', async () => {
    execFileMock.mockImplementation((_file, _args, callback) => {
      const error = new Error(`spawn ${_file} ENOENT`) as Error & { code?: string }
      error.code = 'ENOENT'
      callback(error, '', '')
    })
    const ctx = await mount()
    const posts = await ctx.research.searchPosts('anything')
    expect(posts).toEqual([])
    expect(execFileMock).toHaveBeenCalledTimes(1)
    expect(ctx.research.getStats().failures).toBe(0)
    await ctx.fiber.dispose()
  })
})

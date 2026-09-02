/**
 * Model-facing semantic memory tools over the `ctx.memoryStore` seam: `memory_retain` stores a
 * durable fact (one at a time, or a batch via `items`), `memory_recall` retrieves the most
 * relevant stored facts, `memory_get` retrieves
 * one fact byte-exactly, and `memory_reflect` summarizes what is stored. Mount alongside
 * `@atlasai/atsh-memory` (or any backend that registers `ctx.memoryStore`); the plugin loads
 * only while both `tools` and `memoryStore` are composed. Named exports preserve loader injection
 * metadata.
 * @module @atlasai/atsh-tool-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@atlasai/atsh-tools'
// Type-only: resolves ctx.memoryStore (the dsh-memory declaration augmentation) for the tool
// bodies and brings the seam's option types into scope. Elided at runtime.
import type { MemoryGetOptions, MemoryListOptions, MemoryQueryOptions, MemoryReflectOptions } from '@atlasai/atsh-memory'

export const name = 'tool-memory'
export const inject = ['tools', 'memoryStore']

/** Model-facing memory tool configuration (none today; kept for the loader export shape). */
export interface Config {}

/** Schemastery configuration for the memory tool plugin. */
export const Config: z<Config> = z.object({})

/**
 * Register `memory_recall`, `memory_retain`, and `memory_reflect` on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and the memory service.
 * @param _config - validated plugin config (unused; no options today).
 */
export function apply(ctx: Context, _config: Config): void {
  ctx.tools.register(defineTool({
    name: 'memory_recall',
    description: 'Recall facts and notes you previously retained (semantic memory). '
      + 'Searches the memory store for stored content relevant to `query` and returns the best '
      + 'matches ranked by a 0..1 relevance score. Use it to bring earlier decisions, user '
      + 'preferences, and findings back into context instead of re-deriving them. Scopes to '
      + '`namespace` when given and returns at most `limit` results (default 10, hard ceiling '
      + '50). This is a ranked top-limit subset that may be a possibly-incomplete subset of the '
      + 'store; use `memory_list` or `memory_reflect` for the full contents if you need '
      + 'everything verbatim.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'The memory to search for — a natural-language description of the fact or topic to retrieve.',
      },
      namespace: {
        type: 'string',
        description: 'Only search this namespace (a named area of the store); omitted searches all namespaces.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of matches to return (default 10, hard ceiling 50).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                content: { type: 'string', required: true },
                namespace: { type: 'string', required: true },
                score: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => value.results.length === 0
        ? [{ type: 'text', text: 'No matching memories found.' }]
        : [{
          type: 'text',
          text: value.results
            .map(r => `${r.namespace ? `[${r.namespace}] ` : ''}${r.content} (score ${r.score.toFixed(2)})`)
            .join('\n'),
        }],
    },
    async execute(args) {
      const opts: MemoryQueryOptions = {}
      if (args.namespace !== undefined) opts.namespace = args.namespace
      if (args.limit !== undefined) opts.limit = args.limit
      const results = await ctx.memoryStore.recall(args.query, opts)
      return { results }
    },
    presentCall: args => ({ card: 'generic', title: 'Recall memory', kind: 'other', rawInput: args.query }),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_get',
    description: 'Retrieve ONE stored memory by its exact content string (byte-for-byte match). Unlike '
      + '`memory_recall`, which returns a ranked top-`limit` subset that may be incomplete, `memory_get` '
      + 'returns the single record whose `content` equals `key` exactly, or nothing when no stored fact '
      + 'matches verbatim. Use it to recover facts stored under a known key/value shape — e.g. config keys, '
      + 'decisions pinned as a pair — without fuzzy ranking dropping them. Scopes to `namespace` when given; '
      + 'omitted uses the default namespace.',
    parameters: {
      key: {
        type: 'string',
        required: true,
        description: 'The exact content string to match, byte for byte (e.g. "color=blue" or a pinned value).',
      },
      namespace: {
        type: 'string',
        description: 'Only match in this namespace; omitted uses the default namespace.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          record: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              content: { type: 'string', required: true },
              namespace: { type: 'string', required: true },
              createdAt: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.found
          ? value.record
            ? `${value.record.namespace ? `[${value.record.namespace}] ` : ''}${value.record.content}`
            : 'No exact match found.'
          : 'No exact match found.',
      }],
    },
    async execute(args) {
      const opts: MemoryGetOptions = {}
      if (args.namespace !== undefined) opts.namespace = args.namespace
      const record = await ctx.memoryStore.get(args.key, opts)
      return {
        found: record !== undefined,
        ...(record ? {
          record: {
            id: record.id,
            content: record.content,
            namespace: record.namespace,
            createdAt: record.createdAt,
          },
        } : {}),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Get memory exact', kind: 'other', rawInput: args.key }),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_list',
    description: 'List EVERY stored memory verbatim — the complete, uncapped contents of the '
      + 'memory store. Unlike `memory_recall`, which returns a ranked top-`limit` subset that '
      + 'may be incomplete, `memory_list` returns all stored records byte-for-byte with no '
      + 'result cap. Use it to recover every fact you previously retained under a known '
      + 'key/value shape — e.g. the full set of config pairs or pinned decisions — instead of '
      + 'relying on fuzzy ranking to surface them. Scopes to `namespace` when given; omitted '
      + 'lists the whole store, newest first.',
    parameters: {
      namespace: {
        type: 'string',
        description: 'Only list records in this namespace; omitted lists the entire store.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          records: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                content: { type: 'string', required: true },
                namespace: { type: 'string', required: true },
                createdAt: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => value.records.length === 0
        ? [{ type: 'text', text: 'No memories stored.' }]
        : [{
          type: 'text',
          text: `${value.count} memories:\n` + value.records
            .map(r => `${r.namespace ? `[${r.namespace}] ` : ''}${r.content}`)
            .join('\n'),
        }],
    },
    async execute(args) {
      const opts: MemoryListOptions = {}
      if (args.namespace !== undefined) opts.namespace = args.namespace
      const records = await ctx.memoryStore.list(opts)
      return {
        count: records.length,
        records: records.map(r => ({
          id: r.id,
          content: r.content,
          namespace: r.namespace,
          createdAt: r.createdAt,
        })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'List all memory', kind: 'other', rawInput: args.namespace ?? '' }),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_retain',
    description: 'Store durable facts, decisions, preferences, or notes for later recall (semantic memory). '
      + 'The full `content` is stored verbatim and can be retrieved later with `memory_recall`. Retain '
      + 'information worth remembering across the conversation — project conventions, user preferences, '
      + 'key findings — rather than letting it scroll out of context. '
      + 'Provide EITHER a single `content` string OR an `items` array of facts to store many verbatim '
      + 'facts in ONE call. Optionally scope to `namespace` and attach structured `metadata` (per item '
      + 'when using `items`; item-level values override the top-level `namespace`/`metadata`).',
    parameters: {
      content: {
        type: 'string',
        description: 'A single fact, decision, preference, or note to store, written as a self-contained sentence. '
          + 'Mutually exclusive with `items` (provide exactly one of the two).',
      },
      items: {
        type: 'array',
        description: 'A batch of facts to store in one call. Each entry is `{content, namespace?, metadata?}`. '
          + 'Mutually exclusive with `content` (provide exactly one of the two).',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', required: true, description: 'The fact to store verbatim.' },
            namespace: { type: 'string', description: 'Namespace to store under; omitted inherits the top-level `namespace` or the default namespace.' },
            metadata: {
              type: 'object',
              additionalProperties: true,
              description: 'Optional structured metadata, e.g. {"source": "task-42"} (any JSON object).',
            },
          },
        },
      },
      namespace: {
        type: 'string',
        description: 'Namespace to store under (applies to the batch when `items` is used); omitted uses the default namespace.',
      },
      metadata: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional structured metadata to attach when storing a single `content` fact, e.g. {"source": "task-42"} (any JSON object).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          ids: { type: 'array', items: { type: 'string' } },
          count: { type: 'integer' },
        },
      },
      render: (_args, value) => {
        const ids = (value as { ids?: string[] }).ids
        return [{
          type: 'text',
          text: Array.isArray(ids) && ids.length > 0
            ? `Stored ${ids.length} memories (${ids.join(', ')}).`
            : `Stored memory ${(value as { id: string }).id}.`,
        }]
      },
    },
    async execute(args) {
      const content = (args as { content?: string }).content
      const items = (args as { items?: Array<{ content: string; namespace?: string; metadata?: Record<string, unknown> }> }).items
      if (content === undefined && items === undefined) {
        throw new Error('memory_retain requires either `content` (a single fact) or `items` (a batch), not neither.')
      }
      if (content !== undefined && items !== undefined) {
        throw new Error('memory_retain accepts either `content` or `items`, not both.')
      }
      if (items !== undefined) {
        // Batch form: store every item verbatim in one call, each looping the existing retain seam.
        const namespace = (args as { namespace?: string }).namespace
        const ids: string[] = []
        for (const item of items) {
          const record = await ctx.memoryStore.retain({
            content: item.content,
            ...(item.namespace !== undefined
              ? { namespace: item.namespace }
              : namespace !== undefined ? { namespace } : {}),
            ...(item.metadata !== undefined ? { metadata: item.metadata } : {}),
          })
          ids.push(record.id)
        }
        return { ids, count: ids.length }
      }
      const record = await ctx.memoryStore.retain({
        content: content as string,
        ...(args.namespace !== undefined ? { namespace: args.namespace } : {}),
        ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
      })
      return { id: record.id }
    },
    presentCall: (args) => {
      const items = (args as { items?: Array<{ content: string }> }).items
      return {
        card: 'generic',
        title: 'Store memory',
        kind: 'other',
        rawInput: items !== undefined ? `${items.length} facts` : (args as { content: string }).content,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_reflect',
    description: 'Summarize the current state of your semantic memory store: the total number of stored '
      + 'memories, how they are distributed across namespaces, and the most recently retained entries. '
      + 'Use it to see what you already know before deciding what to retain or recall.',
    parameters: {
      namespace: {
        type: 'string',
        description: 'Scope the summary to one namespace; omitted summarizes the whole store.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          byNamespace: {
            type: 'object',
            additionalProperties: true,
            required: true,
          },
          recent: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                content: { type: 'string', required: true },
                namespace: { type: 'string', required: true },
                createdAt: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.total} memories stored`
          + (Object.keys(value.byNamespace).length > 0
            ? ` (${Object.entries(value.byNamespace).map(([ns, n]) => `${ns === '' ? 'default' : ns}: ${JSON.stringify(n)}`).join(', ')})`
            : '')
          + `. Most recent: ${value.recent.map(r => r.content).join(' | ') || 'none'}.`,
      }],
    },
    async execute(args) {
      const opts: MemoryReflectOptions = {}
      if (args.namespace !== undefined) opts.namespace = args.namespace
      const summary = await ctx.memoryStore.reflect(opts)
      return {
        total: summary.total,
        byNamespace: summary.byNamespace,
        recent: summary.recent.map(r => ({
          id: r.id,
          content: r.content,
          namespace: r.namespace,
          createdAt: r.createdAt,
        })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Reflect on memory', kind: 'other', rawInput: args.namespace ?? '' }),
  }))
}

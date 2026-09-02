/**
 * Model-facing OKR knowledge-graph tools over the `ctx.kgraph` seam: `kgraph_upsert_objective`
 * records or updates an objective, `kgraph_record_evidence` attaches evidence to an objective,
 * and `kgraph_query` lists objectives with stats. Mount alongside `@atlasai/atsh-kgraph`
 * (or any backend that registers `ctx.kgraph`); the plugin loads only while both `tools` and
 * `kgraph` are composed. Named exports preserve loader injection metadata.
 * @module @atlasai/atsh-tool-kgraph
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@atlasai/atsh-tools'
// Type-only: resolves ctx.kgraph (the dsh-kgraph declaration augmentation) for the tool
// bodies and brings the seam's option types into scope. Elided at runtime.
import type { Objective, KGraphStats } from '@atlasai/atsh-kgraph'

export const name = 'tool-kgraph'
export const inject = ['tools', 'kgraph']

/** Model-facing kgraph tool configuration (none today; kept for the loader export shape). */
export interface Config {}

/** Schemastery configuration for the kgraph tool plugin. */
export const Config: z<Config> = z.object({})

/**
 * Register `kgraph_upsert_objective`, `kgraph_record_evidence`, and `kgraph_query` on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and the kgraph service.
 * @param _config - validated plugin config (unused; no options today).
 */
export function apply(ctx: Context, _config: Config): void {
  ctx.tools.register(defineTool({
    name: 'kgraph_upsert_objective',
    description: 'Record or update an OKR objective in the knowledge graph. '
      + 'Use it to persist a goal or objective the agent is working toward, with an optional '
      + 'description. Returns the stored objective with its id.',
    parameters: {
      name: {
        type: 'string',
        required: true,
        description: 'The objective name — a short imperative statement of the goal.',
      },
      description: {
        type: 'string',
        description: 'Optional elaboration of the objective.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          description: { type: 'string' },
          status: { type: 'string' },
          keyResults: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {} } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Objective ${value.name} stored as ${value.id}.` }],
    },
    async execute(args: { name: string; description?: string }) {
      const objective = await ctx.kgraph.upsertObjective({
        name: args.name,
        ...(args.description !== undefined ? { description: args.description } : {}),
      })
      return {
        id: objective.id,
        name: objective.name,
        ...(objective.description !== undefined ? { description: objective.description } : {}),
        status: objective.status,
        keyResults: objective.keyResults,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Record objective', kind: 'other', rawInput: args.name }),
  }))

  ctx.tools.register(defineTool({
    name: 'kgraph_record_evidence',
    description: 'Attach one evidence row to an objective in the knowledge graph. '
      + 'Use it to record a durable pointer to work performed toward an objective — a '
      + 'decision, a completed step, or an observation. Returns the stored evidence row.',
    parameters: {
      objectiveId: {
        type: 'string',
        required: true,
        description: 'The objective id the evidence supports.',
      },
      krId: {
        type: 'string',
        description: 'Optional key-result id the evidence supports.',
      },
      note: {
        type: 'string',
        required: true,
        description: 'The evidence text — a concise, model-visible note about what was done.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          objectiveId: { type: 'string', required: true },
          eventType: { type: 'string' },
          excerpt: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Evidence ${value.id} recorded for objective ${value.objectiveId}.` }],
    },
    async execute(args: { objectiveId: string; krId?: string; note: string }) {
      const evidence = await ctx.kgraph.addEvidence({
        objectiveId: args.objectiveId,
        ...(args.krId !== undefined ? { krId: args.krId } : {}),
        sessionId: 'tool',
        seq: 0,
        eventType: 'tool/kgraph',
        excerpt: args.note,
        time: Date.now(),
      })
      return { id: evidence.id, objectiveId: evidence.objectiveId, eventType: evidence.eventType, excerpt: evidence.excerpt }
    },
    presentCall: args => ({ card: 'generic', title: 'Record evidence', kind: 'other', rawInput: args.note }),
  }))

  ctx.tools.register(defineTool({
    name: 'kgraph_query',
    description: 'List the OKR knowledge graph: all objectives with their key results, '
      + 'plus aggregate stats. Use it to review what goals are recorded and how much '
      + 'evidence backs them.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          objectives: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                description: { type: 'string' },
                status: { type: 'string', required: true },
                createdAt: { type: 'integer' },
                updatedAt: { type: 'integer' },
                keyResults: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string' },
                      objectiveId: { type: 'string' },
                      name: { type: 'string' },
                      metric: { type: 'string' },
                      target: { type: 'string' },
                      current: { type: 'string' },
                      status: { type: 'string' },
                      createdAt: { type: 'integer' },
                      updatedAt: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
          stats: {
            type: 'object',
            additionalProperties: false,
            properties: {
              objectives: { type: 'integer' },
              keyResults: { type: 'integer' },
              evidence: { type: 'integer' },
              sessionsIngested: { type: 'integer' },
            },
          },
        },
      },
      render: (_args, value) => {
        const stats = value.stats
        return [{
          type: 'text',
          text: `${stats?.objectives ?? 0} objectives, ${stats?.evidence ?? 0} evidence rows, ${stats?.sessionsIngested ?? 0} sessions ingested.`,
        }]
      },
    },
    async execute(): Promise<{ objectives: Objective[]; stats: KGraphStats }> {
      const [objectives, stats] = await Promise.all([ctx.kgraph.listObjectives(), ctx.kgraph.getStats()])
      return { objectives, stats }
    },
  }))
}

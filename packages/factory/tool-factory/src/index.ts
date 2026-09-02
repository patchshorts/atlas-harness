// Model-facing factory tools over ctx.factory: bar_critic (the BAR judge)
// and contract_status (plan-contract inspection).

import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@atlasai/atsh-tools'
import z from '@deepseek-ai/schemastery'
import type { BarVerdict } from '@atlasai/atsh-factory'

export const name = 'tool-factory'

export const inject = ['tools', 'factory']

/** Empty tool-factory config: the service reads its own config, the tool exposes no options. */
export interface Config {}

export const Config: z<Config> = z.object({})

export function apply(ctx: Context, _config: Config): void {
  ctx.tools.register(defineTool({
    name: 'bar_critic',
    description: 'score submitted work against a registered factory plan-contract task (the BAR judge)',
    parameters: {
      planId: { type: 'string', required: true },
      taskId: { type: 'string', required: true },
      summary: { type: 'string', required: true },
      evidence: { type: 'array', items: { type: 'string' }, required: true },
      files: { type: 'array', items: { type: 'string' }, required: true },
      blockers: { type: 'array', items: { type: 'string' } },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          verdict: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              taskId: { type: 'string', required: true },
              status: { type: 'string', enum: ['PASS', 'FAIL', 'NOT_SUBMITTED'], required: true },
              passedChecks: { type: 'array', items: { type: 'string' }, required: true },
              reasons: { type: 'array', items: { type: 'string' }, required: true },
            },
          },
        },
      },
      render: (_args, value) => [
        { type: 'text', text: `Bar verdict for ${value.verdict.taskId}: ${value.verdict.status}` },
      ],
    },
    execute(args) {
      const verdict: BarVerdict = ctx.factory.scoreTask(args.planId, {
        taskId: args.taskId,
        summary: args.summary,
        evidence: args.evidence,
        files: args.files,
        ...(args.blockers !== undefined ? { blockers: args.blockers } : {}),
      })
      return Promise.resolve({ verdict })
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Score against plan contract',
      kind: 'other',
      rawInput: `${args.planId} ${args.taskId}`,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'contract_status',
    description: 'list the registered atomic tasks of a factory plan contract',
    parameters: {
      planId: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          planId: { type: 'string', required: true },
          tasks: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                verb: { type: 'string', required: true },
                object: { type: 'string', required: true },
                verifies: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Plan contract ${value.planId}: ${value.tasks.length} tasks` }],
    },
    execute(args) {
      const tasks = ctx.factory.getPlanContract(args.planId)
      if (tasks === undefined) {
        throw new Error(`factory: unknown plan contract "${args.planId}"`)
      }
      return Promise.resolve({ planId: args.planId, tasks })
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Plan contract status',
      kind: 'other',
      rawInput: args.planId,
    }),
  }))
}

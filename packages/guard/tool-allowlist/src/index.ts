/**
 * Fail-closed tool-call allowlist gate (`ctx.guardToolAllowlist`). A
 * `tools/execute` wrapper that rejects any tool name not on the configured
 * allowlist with a structured denial result and an auditable event. This is
 * the load-bearing in-band prompt-injection defense boundary for the atlas
 * harness: instruction-like content disguised as tool output that would
 * trigger an out-of-list tool call dies here, structurally, not in the prompt.
 *
 * Fail-closed by default: an empty or absent allowlist denies every tool
 * call. There is no permissive default. The gate adds one auditable event
 * (`guard/allowlist-deny`) and never mutates session log, message history, or
 * projections — it observes the request/response cycle as an append-only
 * effect (golden rule: history is untouched by construction).
 *
 * @module @atlasai/atsh-tool-allowlist
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ToolDispatchExecution, ToolExecutionResult } from '@atlasai/atsh-tools'

/** The structured error code carried on a denied tool result. */
export const TOOL_NOT_ALLOWLISTED = 'TOOL_NOT_ALLOWLISTED'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-allowlist'

/** The tool registry service this plugin wraps (`tools/execute`). */
export const inject = ['tools']

/** Config keys accepted by the schemastery schema (misspellings fail loud). */
const SUPPORTED_CONFIG_KEYS = new Set(['enabled', 'allowlist', 'denyReason'])

/**
 * Reject stale or misspelled config keys before defaults can hide them.
 */
function validateConfigKeys(config: Record<string, unknown>): void {
  for (const key of Object.keys(config)) {
    if (!SUPPORTED_CONFIG_KEYS.has(key)) {
      throw new Error(`ToolAllowlistConfig: unknown key "${key}"`)
    }
  }
}

/** Schemastery config for the gate. */
export interface ToolAllowlistConfig {
  /** Master switch; `false` disables the gate entirely (never a shipped default). */
  enabled?: boolean
  /** Tool names allowed to execute. Empty list denies everything (fail-closed). */
  allowlist?: string[]
  /** Model-facing deny reason template; `{name}` is replaced with the tool name. */
  denyReason?: string
}

const DEFAULT_DENY_REASON = 'tool "{name}" is not on the execution allowlist'

/** The auditable payload emitted when a call is denied. */
export interface ToolAllowlistDenyEvent {
  /** The rejected tool name. */
  name: string
  /** The calling agent (scope routing key), when the call has one. */
  agent?: string
}

/**
 * The gate Service. Constructing it registers the `tools/execute` wrapper;
 * mounting the plugin is what arms the gate. The allowlist is a plain set for
 * O(1) membership; the auditable event rides the declared
 * `guard/allowlist-deny` event.
 */
export class ToolAllowlistService extends Service {
  static Config = z.object({
    enabled: z.boolean().default(true),
    allowlist: z.array(z.string()).default([]),
    denyReason: z.string().default(DEFAULT_DENY_REASON),
  })

  private readonly enabled: boolean
  private readonly allowlist: ReadonlySet<string>
  private readonly denyReason: string

  constructor(ctx: Context, config: ToolAllowlistConfig) {
    super(ctx, 'guardToolAllowlist')
    validateConfigKeys(config as Record<string, unknown>)
    this.enabled = config.enabled ?? true
    this.allowlist = new Set(config.allowlist ?? [])
    this.denyReason = config.denyReason ?? DEFAULT_DENY_REASON

    ctx.on('tools/execute', async (exec: ToolDispatchExecution, next) => {
      if (!this.enabled) return next()
      if (this.allowlist.has(exec.name)) return next()
      this.ctx.emit('guard/allowlist-deny', {
        name: exec.name,
        ...(exec.agent ? { agent: String(exec.agent.id) } : {}),
      } satisfies ToolAllowlistDenyEvent)
      return this.denyResult(exec.name)
    })
  }

  /**
   * The structured denial substituted for an out-of-list call. Same shape as
   * the guard `timeout-policy` denial: `isError` with a scoped `error.code`
   * so retry/sandbox plugins and replay can route on it.
   *
   * @param toolName - the rejected tool name.
   * @returns the `isError` {@link ToolExecutionResult} with a
   *   `TOOL_NOT_ALLOWLISTED` error.
   */
  private denyResult(toolName: string): ToolExecutionResult {
    const message = this.denyReason.replace('{name}', toolName)
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
      error: {
        message,
        info: { name: 'ToolNotAllowlistedError', code: TOOL_NOT_ALLOWLISTED },
      },
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    guardToolAllowlist: ToolAllowlistService
  }

  interface Events {
    /**
     * Emitted when an out-of-list tool call is denied at the gate.
     *
     * @param data - the denial payload: the rejected tool name and the calling
     *   agent (when the call has one).
     * @mode emit
     */
    'guard/allowlist-deny'(data: ToolAllowlistDenyEvent): void
  }
}

export default ToolAllowlistService

// LaneGuardService: the ctx.laneGuard capability.
//
// Fix 12/6 lane separation + injection defense — channel-based instruction
// marking (system > tool output), a tool-call allowlist at the harness
// boundary, a PromptArmor-pattern sanitization pass, and taint-aware
// verification for the in-band class. Golden rule: every pass is DERIVED —
// channel marking, sanitization, and taint verification produce NEW arrays
// and strings and never write to messages, system prompts, the session log,
// or projections. The single runtime effect is the tool-call allowlist guard
// registered against the tools guard layer (optional via ctx.get('tools')),
// disposed with the fiber.

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { compileRules, evaluateAllowlist } from './allowlist.ts'
import { markChannels as deriveChannels } from './channels.ts'
import { sanitize as runSanitize } from './sanitize.ts'
import { verifyTaintedComposition } from './taint.ts'
import type {
  AllowDecision,
  AllowPolicy,
  ChanneledMessage,
  DefenseResult,
  FactTriple,
  InjectionPayload,
  LaneGuardConfig,
  LaneVetoRecord,
  SanitizeResult,
  TaintVerdict,
} from './types.ts'

const SUPPORTED_CONFIG_KEYS = new Set(['enabled', 'allow', 'deny', 'sanitize', 'taint'])

/** Reject stale or misspelled config keys before defaults can hide them. */
function validateConfigKeys(config: LaneGuardConfig): void {
  for (const key of Object.keys(config)) {
    if (!SUPPORTED_CONFIG_KEYS.has(key)) {
      throw new Error(`LaneGuardConfig: unknown key "${key}"`)
    }
  }
}

/** Shape of the optional tools service (loaded via ctx.get, never ctx.tools). */
interface ToolsLike {
  guard(fn: (execution: { name: string; arguments?: unknown }) => string | undefined): () => void
}

/**
 * The Fix 12/6 lane-separation seam: channel-based instruction marking, the
 * tool-call allowlist gate at the harness boundary, the PromptArmor-pattern
 * sanitization pass, and taint-aware verification for the in-band class.
 *
 * State is config only — the gate is a pure function of the tool name and
 * the passes are pure — which is what makes the service golden-rule safe.
 */
export class LaneGuardService extends Service {
  static Config = z.object({
    enabled: z.boolean().default(true),
    allow: z.array(z.string()).default([]),
    deny: z.array(z.string()).default([]),
    sanitize: z.boolean().default(true),
    taint: z.boolean().default(true),
  })

  private readonly enabled: boolean
  private readonly allow: string[]
  private readonly deny: string[]
  private readonly sanitizeEnabled: boolean
  private readonly taintEnabled: boolean

  constructor(ctx: Context, config: LaneGuardConfig) {
    super(ctx, 'laneGuard')
    validateConfigKeys(config)
    this.enabled = config.enabled ?? true
    this.allow = compileRules(config.allow ?? [])
    this.deny = compileRules(config.deny ?? [])
    this.sanitizeEnabled = config.sanitize ?? true
    this.taintEnabled = config.taint ?? true
    if (this.enabled) {
      const tools = this.ctx.get('tools') as ToolsLike | undefined
      ctx.effect(() => {
        const disposer = tools?.guard(execution => this.guardReason(execution))
        return disposer ?? (() => {})
      }, 'factory-lane-guard: tool-call allowlist gate')
    }
    ctx.effect(() => () => {}, 'factory-lane-guard: channel marking, sanitization, and taint passes own no external resources')
  }

  private get policy(): AllowPolicy {
    return { allow: this.allow, deny: this.deny }
  }

  /**
   * The tool-call allowlist gate: evaluate the execution against the policy
   * and return the denial reason, or undefined when allowed. Emits
   * 'lane/veto' on denial. This is the exact function handed to
   * `ctx.tools.guard`.
   *
   * @param execution - the tool execution: name plus optional parsed arguments.
   * @returns the allowlist denial reason, or undefined when the call is
   *   allowed (or the service is disabled — passive, and the gate is not
   *   registered either).
   */
  guardReason(execution: { name: string; arguments?: unknown }): string | undefined {
    if (!this.enabled) return undefined
    const decision = evaluateAllowlist(execution.name, this.policy)
    if (!decision.allowed && decision.reason) {
      const record: LaneVetoRecord = { name: execution.name, reason: decision.reason, ts: Date.now() }
      this.ctx.emit('lane/veto', record)
    }
    return decision.reason
  }

  /**
   * Evaluate one tool call against the allowlist policy.
   *
   * @param exec - the tool execution: name plus optional parsed arguments.
   * @returns the allow decision (allowed, matched pattern, denial reason).
   * @throws when the service is disabled ('lane-guard disabled').
   */
  evaluateGate(exec: { name: string; arguments?: unknown }): AllowDecision {
    if (!this.enabled) throw new Error('lane-guard disabled')
    return evaluateAllowlist(exec.name, this.policy)
  }

  /**
   * Derive channel markings for a message list without mutating it.
   *
   * @param messages - the message list (role + content per entry).
   * @returns a NEW array of channeled messages; the input array and every
   *   input object are never mutated (golden rule).
   * @throws when the service is disabled ('lane-guard disabled').
   */
  markChannels(messages: ReadonlyArray<{ role: string; content: string }>): ChanneledMessage[] {
    if (!this.enabled) throw new Error('lane-guard disabled')
    return deriveChannels(messages)
  }

  /**
   * Strip injected prompts from text (PromptArmor-pattern deterministic pass).
   * Passive when disabled or when the sanitize pass is off — this pass is
   * defense-in-depth, not a gate.
   *
   * @param text - the raw untrusted text (typically tool output).
   * @returns the sanitized text, strip hits, and total chars removed.
   */
  sanitize(text: string): SanitizeResult {
    if (!this.enabled || !this.sanitizeEnabled) return { text, hits: [], stripped: 0 }
    return runSanitize(text)
  }

  /**
   * Taint-aware verification of a composed output against extracted triples.
   *
   * @param output - the composed output text.
   * @param triples - the fact triples extracted from CONTENT.
   * @returns the verdict: verified, traced count, and untraced clauses.
   * @throws when the service is disabled ('lane-guard disabled').
   */
  verifyComposed(output: string, triples: FactTriple[]): TaintVerdict {
    if (!this.enabled) throw new Error('lane-guard disabled')
    if (!this.taintEnabled) return { verified: true, traced: 0, untraced: [] }
    return verifyTaintedComposition(output, triples)
  }

  /**
   * The fixture seam: one deterministic call, zero LLM, that defends a
   * single payload — sanitize first (resisted when any strip fired), then
   * the allowlist gate (resisted when the directed tool is not allowed),
   * else not resisted.
   *
   * @param payload - the injection payload (id, class, content, directedTool).
   * @returns the defense result: resisted, via ('sanitize' | 'allowlist' |
   *   'none'), and detail (strip hit markers or the allowlist reason).
   * @throws when the service is disabled ('lane-guard disabled').
   */
  defend(payload: InjectionPayload): DefenseResult {
    if (!this.enabled) throw new Error('lane-guard disabled')
    const cleaned = this.sanitize(payload.content)
    if (cleaned.stripped > 0) {
      return {
        payloadId: payload.id,
        resisted: true,
        via: 'sanitize',
        detail: cleaned.hits.map(hit => hit.marker).join(', '),
      }
    }
    if (payload.directedTool) {
      const decision = this.evaluateGate({ name: payload.directedTool })
      if (!decision.allowed) {
        const detail = decision.reason
        return detail === undefined
          ? { payloadId: payload.id, resisted: true, via: 'allowlist' }
          : { payloadId: payload.id, resisted: true, via: 'allowlist', detail }
      }
    }
    return { payloadId: payload.id, resisted: false, via: 'none' }
  }
}

export default LaneGuardService

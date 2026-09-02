/**
 * Relevance-gated selective prompt assembly (prompt-lume).
 *
 * The L3 assembly layer: a `system-prompt/assemble` waterfall listener that
 * distills the current turn's working intent, retrieves the most-germane chunks
 * through `ctx.promptCorpus.recall`, cross-encoder re-ranks them, byte-budget
 * allocates to the most-germane corpora first, and injects a
 * provenance-labeled task-aligned region AFTER the byte-stable core. The core
 * sections (harness identity, persona, capability grammar) are never touched,
 * so the provider prompt-cache read on the core survives across turns.
 *
 * @module @atlasai/atsh-prompt-lume
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  AssembleContext,
  PromptAssembly,
} from '@atlasai/atsh-system-prompt'
import { renderPrompt } from '@atlasai/atsh-system-prompt'
import type { PromptRecallResult } from '@atlasai/atsh-prompt-corpus'
import { createUserMessage } from '@atlasai/atsh-llm'
import type { Session, SessionEvent } from '@atlasai/atsh-session'
import { rerank } from './reranker.ts'
import { allocateBudget, type BudgetEntry } from './budget.ts'
import {
  TASK_ALIGNED_HEADER,
  renderEntry,
} from './region.ts'
import { CostSidecar } from './cost.ts'
import { GRADE_HOOKS, GRADE_ORDER, selectGradeForComplexity } from './grade.ts'
import type { ReductionGrade } from './grade.ts'

/** Provenance plugin tag for the emitted task-aligned region user message. */
const LUME_PLUGIN_SOURCE = '@atlasai/atsh-prompt-lume/region'

declare module '@deepseek-ai/cordis' {
  interface Context {
    promptLume: PromptLumeService
  }

  interface Events {
    /**
     * Fired after each prompt-lume assembly with a primed turn.
     *
     * Carries the per-call cost record (core/region/input heuristic tokens,
     * cache-hit vs miss, budget vs actual region bytes) and lets cost
     * consumers feed the corrections-per-session benchmark. The cumulative
     * totals are also readable via {@link PromptLumeService.costSummary}.
     * @param record - the detached immutable per-call cost record.
     * @mode emit
     */
    'prompt-lume/cost'(this: Context, record: import('./cost.ts').PromptLumeCostRecord): void
  }
}

/** The current turn's working intent and its corpus-affinity kind. */
export interface TurnSurface {
  /** Cheap working-intent query distilled from the user message + last agent action. */
  intent: string
  /**
   * Turn kind → default corpus priority: `tool` skills-first, `workspace`
   * workspace-first, `identity` persona-first, `general` all corpora by relevance.
   */
  kind?: 'tool' | 'workspace' | 'identity' | 'general'
}

/** Default corpus priority per turn kind. */
const KIND_PRIORITY: Record<NonNullable<TurnSurface['kind']>, readonly string[]> = {
  tool: ['skills'],
  workspace: ['agent-instructions', 'workspace'],
  identity: ['persona', 'system', 'soul'],
  general: [],
}

/** Plugin config for the prompt-lume assembly layer. */
export interface PromptLumeConfig {
  /** Master switch; when off the listener never injects a region. Default true. */
  enabled?: boolean
  /**
   * Reduction grade. When set, the per-grade hook-width row (see
   * {@link resolveGradeKnobs}) resolves topK/budgetBytes/rerankThreshold (and
   * the recall search span) from the grade — the explicit scalar knobs below
   * are ignored. When UNSET and no explicit scalar knob is set, the hook is
   * auto-selected per-turn by problem complexity via
   * {@link selectGradeForComplexity}: trivial intents resolve the narrowest
   * hook (low), complex problems the widest (xhigh). Every grade is still a
   * context wall; there is no zero grade.
   */
  reducerGrade?: ReductionGrade
  /** Retrieval over-fetch and rerank result cap. Default 10. */
  topK?: number
  /** Byte budget for the task-aligned region. Default 4096. */
  budgetBytes?: number
  /** Cross-encoder drop threshold; below it a chunk is dropped. Default 0. */
  rerankThreshold?: number
  /** Explicit corpus priority, overriding the per-kind default. */
  corpusPriority?: string[]
}

/**
 * Knob values resolved from a reduction grade's hook-width row.
 *
 * A grade maps to the same scalars the service already consumes — the width
 * of the retrieval hook decides how much context commits. The byte-stable
 * core is untouched at every grade; these knobs touch only the
 * retrieval/region path.
 */
export interface GradeResolvedKnobs {
  /** Result cap: how many most-germane chunks may commit (chunkCommitCount). */
  topK: number
  /** Max bytes the task-aligned region may occupy (regionByteBudget). */
  budgetBytes: number
  /** Cross-encoder drop cutoff; higher keeps fewer chunks (rankingCutoff). */
  rerankThreshold: number
  /** Recall over-fetch multiplier for corpus search width (corpusSearchSpan). */
  searchSpan: number
}

/**
 * Resolve the per-grade hook-width row into service knobs.
 *
 * Monotonic across grades: low has the narrowest hook (least context), xhigh
 * the widest (most context). The rows live in grade.ts (GRADE_HOOKS); this is
 * the binding that turns a `reducerGrade` (or an auto-selected complexity
 * grade) into the concrete scalars the assembly listener consumes.
 */
export function resolveGradeKnobs(grade: ReductionGrade): GradeResolvedKnobs {
  const hook = GRADE_HOOKS[grade]
  return {
    topK: hook.chunkCommitCount,
    budgetBytes: hook.regionByteBudget,
    rerankThreshold: hook.rankingCutoff,
    searchSpan: hook.corpusSearchSpan,
  }
}

/**
 * Register `ctx.promptLume`: a `system-prompt/assemble` listener stages the
 * relevance-gated, provenance-labeled task-aligned region for that turn, and a
 * pre-step flushes it as a self-superseding tail user/message via
 * {@link emitRegion}. The region is never committed to the byte-stable core
 * section list, so the provider KV prefix cache read stays alive across turns.
 *
 * The constructor registers the assemble listener, so once this service's load
 * settles every subsequent assembly is relevance-gated (when the caller has
 * primed a turn surface). With no primed turn or an empty intent the listener
 * passes the assembly through unchanged — core only, and no region is staged
 * for emission.
 *
 * @memberof module:prompts/prompt-lume
 */
export class PromptLumeService extends Service {
  static inject = ['memoryStore', 'promptCorpus']
  static Config: z<PromptLumeConfig> = z.object({
    enabled: z.boolean().default(true),
    reducerGrade: z.union(GRADE_ORDER.map(grade => z.const(grade))).default(undefined as unknown as ReductionGrade),
    // Preserve omission on the scalars so a config `{}` (no grade, no explicit
    // scalar) is schema-legal and the AUTO path fires (per-turn complexity
    // selection). The scalar fallbacks (10 / 4096 / 0) live in the constructor.
    topK: z.number().default(undefined as unknown as number),
    budgetBytes: z.number().default(undefined as unknown as number),
    rerankThreshold: z.number().default(undefined as unknown as number),
    // Preserve omission so an unset priority uses the per-kind default.
    corpusPriority: z.array(z.string()).default(undefined as unknown as string[]),
  })

  private readonly enabled: boolean
  /** Static reducerGrade (when set): the sole knob source for the graded path. */
  private readonly reducerGrade: ReductionGrade | undefined
  /** True when the caller set any explicit scalar knob (topK/budgetBytes/rerankThreshold). */
  private readonly explicitScalars: boolean
  private readonly topK: number
  private readonly budgetBytes: number
  private readonly rerankThreshold: number
  private readonly searchSpan: number
  private readonly corpusPriority: readonly string[] | undefined
  private readonly sidecar: CostSidecar
  private turn: TurnSurface | undefined
  /**
   * The task-aligned region text assembled for the CURRENT turn, awaiting
   * emission. Emitted as a self-superseding tail user/message (see
   * {@link emitRegion}) so the byte-stable core stays ahead of the whole
   * conversation history — the provider KV prefix cache survives region drift.
   */
  private pendingRegion: string | undefined
  /**
   * Seq of the last task-aligned region user message emitted by this service,
   * keyed by session id. Keyed per session (not a single scalar) because the
   * region wall lives on a specific session's surface: a replace span must
   * name a node that exists on THAT session, and one service instance can be
   * driven against more than one session (tests, a re-parented session).
   */
  private lastEmittedSeqBySession = new Map<string, number>()

  constructor(ctx: Context, config: PromptLumeConfig = {}) {
    super(ctx, 'promptLume')
    this.enabled = config.enabled ?? true
    // The hook-width ladder drives how much context commits. Precedence (see
    // knobsFor): an explicit reducerGrade wins (sole knob source); else an
    // explicit scalar knob override wins; else the hook is AUTO-selected per
    // turn by problem complexity (selectGradeForComplexity) — trivial intents
    // get the narrowest hook, complex problems the widest.
    this.reducerGrade = config.reducerGrade
    this.explicitScalars =
      config.topK !== undefined ||
      config.budgetBytes !== undefined ||
      config.rerankThreshold !== undefined
    // Scalar defaults kept for the explicit-scalar path (each preserves its
    // DEFAULT 10 / 4096 / 0 when another scalar alone was overridden).
    this.topK = config.topK ?? 10
    this.budgetBytes = config.budgetBytes ?? 4096
    this.rerankThreshold = config.rerankThreshold ?? 0
    this.searchSpan = 3 // preserves the pre-grade recall over-fetch (topK * 3)
    this.corpusPriority = config.corpusPriority
    this.sidecar = new CostSidecar()
    // Waterfall listener: the returned assembly is authoritative; we mutate the
    // mutable assembly in place and delegate to continue the chain.
    ctx.on('system-prompt/assemble', (assembly, context, next) =>
      this.assemble(assembly, context, next))
  }

  /**
   * Record the current turn surface before the next assembly.
   *
   * The assemble event carries no turn text, so the caller (the agent loop)
   * primes the distilled working intent here; the listener consumes and clears
   * it on the next assembly. An unprimed or empty intent yields core-only.
   *
   * @param turn - the distilled intent and optional corpus-affinity kind.
   */
  primeTurn(turn: TurnSurface): void {
    this.turn = turn
  }

  /** Corpus priority for a turn kind: explicit config wins, else the kind default. */
  private priorityFor(kind: TurnSurface['kind']): readonly string[] {
    if (this.corpusPriority !== undefined) return this.corpusPriority
    return kind ? KIND_PRIORITY[kind] : KIND_PRIORITY.general
  }

  /**
   * Resolve the hook-width knobs for one turn (per-turn, because the AUTO
   * path is per-turn). Precedence:
   * 1. explicit reducerGrade -> static row (sole knob source).
   * 2. explicit scalar override (any of topK/budgetBytes/rerankThreshold) ->
   *    the literal scalars.
   * 3. neither -> AUTO: select the grade by problem complexity and resolve its
   *    row (trivial intents narrow, complex problems wide).
   */
  private knobsFor(turn: TurnSurface): GradeResolvedKnobs {
    if (this.reducerGrade) return resolveGradeKnobs(this.reducerGrade)
    if (this.explicitScalars) {
      return {
        topK: this.topK,
        budgetBytes: this.budgetBytes,
        rerankThreshold: this.rerankThreshold,
        searchSpan: this.searchSpan,
      }
    }
    return resolveGradeKnobs(selectGradeForComplexity(turn))
  }

  /**
   * Cumulative cost-sidecar totals across every recorded assembly.
   *
   * Feeds the corrections-per-session benchmark without requiring a listener
   * to have captured the per-call `prompt-lume/cost` events.
   * @returns the aggregated cost summary (calls, cache hits/misses, token and
   * region totals) as a detached immutable record.
   */
  costSummary(): ReturnType<CostSidecar['summary']> {
    return this.sidecar.summary()
  }

  private async assemble(
    _assembly: PromptAssembly,
    _context: AssembleContext,
    next: () => Promise<PromptAssembly>,
  ): Promise<PromptAssembly> {
    const turn = this.turn
    this.turn = undefined
    if (!this.enabled || turn === undefined || turn.intent.length === 0) return next()

    // Per-turn hook-width knobs: explicit reducerGrade, else explicit scalar
    // override, else complexity-auto-select (the harness default).
    const knobs = this.knobsFor(turn)
    const regionText = await this.buildRegionText(turn, knobs)
    // Retain the freshly assembled region for emission as a tail user/message
    // (a pre-step flushes it). It is NOT committed to the byte-stable core
    // section list, so upcoming sections and conversation history stay ahead
    // of it and the provider KV prefix cache read survives region drift.
    this.pendingRegion = regionText

    const settled = await next()

    // Cost record: render the byte-stable core (every section — the region is
    // no longer a section) so cache-hit vs miss reflects exactly what the
    // provider prompt-cache reads across turns.
    const core = renderPrompt(settled)
    const record = this.sidecar.record(core, regionText, knobs.budgetBytes)
    this.ctx.emit('prompt-lume/cost', record)
    return settled
  }

  /**
   * Build the provenance-labeled, budget-allocated task-aligned region text
   * for one turn, or the empty string when nothing germane commits. Kept in
   * one place because both the cache-read cost record and the tail emission
   * consume it.
   */
  private async buildRegionText(turn: TurnSurface, knobs: GradeResolvedKnobs): Promise<string> {
    const recalled: PromptRecallResult[] = await this.ctx.promptCorpus.recall(
      turn.intent,
      { limit: knobs.topK * knobs.searchSpan },
    )
    const reranked = await rerank(turn.intent, recalled, {
      threshold: knobs.rerankThreshold,
      limit: knobs.topK,
    })
    if (reranked.length === 0) return ''
    const entries: BudgetEntry[] = reranked.map(chunk => ({
      text: renderEntry(chunk, turn.intent),
      corpus: chunk.corpus,
      rerankScore: chunk.rerankScore,
    }))
    const kept = allocateBudget(entries, {
      budgetBytes: knobs.budgetBytes,
      corpusPriority: this.priorityFor(turn.kind),
    })
    if (kept.length === 0) return ''
    return [TASK_ALIGNED_HEADER, ...kept.map(entry => entry.text)].join('\n\n')
  }

  /**
   * Emit the pending task-aligned region as a self-superseding user message
   * appended AFTER the retained conversation history.
   *
   * The message supersedes the previous region message (when one was emitted)
   * via `surfaceOp: { op: 'replace', start, end }` spanning exactly the prior
   * region node, so exactly one region wall is ever on the surface and the
   * byte-stable core prefix ahead of history stays provider-cache-stable. The
   * first emission appends normally (no prior node to replace).
   *
   * @param session - the live agent session to append the region onto.
   * @returns the emitted user message, or undefined when no region is pending.
   */
  emitRegion(session: Session): SessionEvent<'user/message'> | undefined {
    if (this.pendingRegion === undefined || this.pendingRegion.length === 0) return undefined
    const anyPending = this.pendingRegion
    this.pendingRegion = undefined
    const message = createUserMessage({
      content: [{ type: 'text', text: anyPending }],
      source: { kind: 'plugin', plugin: LUME_PLUGIN_SOURCE },
    })
    const sessionKey = String(session.id)
    const priorSeq = this.lastEmittedSeqBySession.get(sessionKey)
    const event = session.append('user/message', message, priorSeq === undefined
      ? { surfaceOp: 'append' }
      : {
        surfaceOp: { op: 'replace', start: priorSeq, end: priorSeq },
        sourceEventSeqs: [priorSeq],
      })
    this.lastEmittedSeqBySession.set(sessionKey, event.seq)
    return event
  }

  /**
   * True when the current turn's assembled region is still pending emission.
   * Lets the driving pre-step decide whether an emission is merited.
   *
   * @returns whether a region is staged (non-empty) and awaits emission.
   */
  hasPendingRegion(): boolean {
    return this.pendingRegion !== undefined && this.pendingRegion.length > 0
  }
}

export { rerank } from './reranker.ts'
export type {
  RerankCandidate,
  RerankOptions,
  RerankOptions as RerankerOptions,
  RerankedResult,
  CrossEncoderScore,
} from './reranker.ts'
export { allocateBudget } from './budget.ts'
export type { BudgetEntry, BudgetOptions } from './budget.ts'
export { neutralizePromptText, provenanceFor, renderEntry, TASK_ALIGNED_HEADER, TASK_ALIGNED_SECTION } from './region.ts'
export { GRADE_HOOKS, GRADE_ORDER, selectGradeForComplexity } from './grade.ts'
export type { GradeHookWidth, ReductionGrade, ComplexityTurn } from './grade.ts'
export { CapabilityRegistry, scoreCapability } from './extend.ts'
export type { AcquisitionScope, CapabilityCandidate, CapabilitySlot, LookupOptions as CapabilityLookupOptions } from './extend.ts'
export { widenOnMiss } from './widen.ts'
export type { WidenOutcome, WidenPolicy, WidenStep } from './widen.ts'
export { guardExtension, DENY_ALL } from './guard.ts'
export type { ApprovalGate, GuardedDecision, SelfExtensionBudget } from './guard.ts'

export default PromptLumeService

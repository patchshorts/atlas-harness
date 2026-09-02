/**
 * Domain capability table: which tasks a model can be routed toward.
 *
 * Capabilities are configured, never fabricated: a model is declared capable
 * of a domain only when that domain carries benchmark scores, and reasoning
 * is additionally true for any model at the highest reasoning tier. The empty
 * table (the default) encodes no capabilities, so the selector (T3, later)
 * routes nothing until a registry supplies entries.
 *
 * Benchmark scores are 0-100 pass rates: code {sweBench, humanEval},
 * math {gpqa, aime}, knowledge {mmlu}, reasoning {arcAgi2}.
 *
 * @module @atlasai/atsh-llm/cost/capability
 */

import z from '@deepseek-ai/schemastery'

/**
 * The four capability domains a model can be routed toward.
 */
export type DomainName = 'code' | 'math' | 'knowledge' | 'reasoning'

/** Code-domain benchmark scores (0-100). */
export interface CodeScores {
  /** SWE-bench Verified pass rate. */
  sweBench?: number
  /** HumanEval pass rate. */
  humanEval?: number
}

/** Math-domain benchmark scores (0-100). */
export interface MathScores {
  /** GPQA pass rate. */
  gpqa?: number
  /** AIME pass rate. */
  aime?: number
}

/** Knowledge-domain benchmark scores (0-100). */
export interface KnowledgeScores {
  /** MMLU pass rate. */
  mmlu?: number
}

/** Reasoning-domain benchmark scores (0-100). */
export interface ReasoningScores {
  /** ARC AGI-2 pass rate. */
  arcAgi2?: number
}

/** Per-domain benchmark score sets. An absent domain means "not capable". */
export interface DomainScores {
  code?: CodeScores
  math?: MathScores
  knowledge?: KnowledgeScores
  reasoning?: ReasoningScores
}

/**
 * One model's capability registry entry.
 *
 * `domains` withholds every untested domain, and `reasoningTier` ranks the
 * model's reasoning strength (1-4).
 */
export interface ModelCapability {
  /** Task benchmark scores; an absent domain is one the model cannot handle. Optional — absent means the empty (no-capability) table. */
  domains?: DomainScores
  /** Context window, in tokens. */
  contextWindow: number
  /** Reasoning tier 1-4; 4 = highest reasoning capability. */
  reasoningTier: number
}

/** Model name → per-model capability. An empty table encodes nothing. */
export type ModelCapabilityTable = Readonly<Record<string, ModelCapability>>

/** The highest reasoning tier; a model at this tier is reasoning-capable. */
export const HIGHEST_REASONING_TIER = 4

const benchmarkScore = z.number().min(0).max(100)

const codeScoresSchema = z.object({ sweBench: benchmarkScore, humanEval: benchmarkScore })
const mathScoresSchema = z.object({ gpqa: benchmarkScore, aime: benchmarkScore })
const knowledgeScoresSchema = z.object({ mmlu: benchmarkScore })
const reasoningScoresSchema = z.object({ arcAgi2: benchmarkScore })

/**
 * Validates one model capability; absent domains materialize as empty bags.
 * Absent score fields are tolerated and dropped (the benchmark is unproven).
 */
export const ModelCapabilitySchema: z<ModelCapability> = z.object({
  domains: z.object({
    code: codeScoresSchema,
    math: mathScoresSchema,
    knowledge: knowledgeScoresSchema,
    reasoning: reasoningScoresSchema,
  }),
  contextWindow: z.number().min(1).required(),
  reasoningTier: z.number().min(1).max(HIGHEST_REASONING_TIER).required(),
})

/** Validates a whole capability table; an absent table defaults to the empty table. */
export const ModelCapabilityTableSchema: z<ModelCapabilityTable> = z
  .dict(ModelCapabilitySchema)
  .default({})

/** The no-capability default table; no model is declared capable. */
export function emptyCapabilityTable(): ModelCapabilityTable {
  return {}
}

/**
 * Whether one model may be routed toward a domain.
 *
 * A domain is capable when it carries at least one benchmark score; reasoning
 * is additionally true for any model at the highest tier, even without an
 * explicit AGI score. Every domain bag materializes as an object, so an empty
 * bag (no benchmark scores) is the "not capable" signal.
 */
export function isCapable(model: ModelCapability, domain: DomainName): boolean {
  const bag = model.domains?.[domain]
  switch (domain) {
    case 'code':
    case 'math':
    case 'knowledge':
      return bag !== undefined && Object.keys(bag).length > 0
    case 'reasoning':
      return (
        (bag !== undefined && Object.keys(bag).length > 0) ||
        model.reasoningTier >= HIGHEST_REASONING_TIER
      )
  }
}

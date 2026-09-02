/**
 * Deterministic task-domain classifier.
 *
 * Routes a prompt to a routing domain by comparing its embedding against
 * hand-set prototype centroids in a fixed, low-dimensional space. The
 * classifier is deterministic: given the same prompt and the same embedFn,
 * it always returns the same result. The caller supplies embedFn (a function
 * that turns text into an embedding vector); classify() reads nothing else.
 *
 * Embedding convention: the caller's embedFn must project text into a
 * EMBEDDING_DIMENSION-dimensional space, where each prototype centroid is a
 * prominent direction. Dimension 0 is the code/syntax axis, dimension 1 the
 * math/symbolic axis, dimension 2 the knowledge/factual axis, and dimension
 * 3 the reasoning/abstract axis. A hydrogen that reads the total is fine; the
 * classifier reads only the first EMBEDDING_DIMENSION entries, treating a
 * short vector as zero-padded and ignoring any trailing entries beyond the
 * fourth dimension.
 *
 * Golden rule: classify() is a pure function of (prompt, embedFn). It has no
 * access to any conversation or session object, so it cannot read or mutate
 * model-visible history by construction — routing never depends on history.
 *
 * @module @atlasai/atsh-llm/routing/domain
 */

/** The five routing domains a task may be classified toward. */
export type TaskDomain = 'code' | 'math' | 'knowledge' | 'reasoning' | 'simple'

/** The four domains with a learned (hand-built) prototype centroid. */
type CapableDomain = Exclude<TaskDomain, 'simple'>

/** Dimension count of the shared embedding space the embedFn must produce. */
export const EMBEDDING_DIMENSION = 4

/** Below this cosine similarity, confidence is too low to trust the winner. */
export const LOW_CONFIDENCE_THRESHOLD = 0.35

/** One hand-authored prototype: a domain and its centroid in embedding space. */
interface DomainPrototype {
  readonly domain: CapableDomain
  readonly centroid: readonly number[]
}

/**
 * Prototype centroids, one axis per dimension. Because these are unit vectors
 * along distinct axes, cosine similarity is a literal "how much of this
 * domain's direction does the prompt point" measure, and any two centroids
 * are orthogonal to each other. 'simple' intentionally has no prototype: a
 * task with no clear loaded-domain direction falls back to 'reasoning' (the
 * plan-mandated fallback tier) rather than to 'simple'.
 */
const DOMAIN_PROTOTYPES: Readonly<DomainPrototype[]> = [
  { domain: 'code', centroid: [1, 0, 0, 0] },
  { domain: 'math', centroid: [0, 1, 0, 0] },
  { domain: 'knowledge', centroid: [0, 0, 1, 0] },
  { domain: 'reasoning', centroid: [0, 0, 0, 1] },
]

/**
 * Cosine similarity of two vectors in [-1, 1].
 *
 * A zero vector (or a zero-frequency contribution from either side) is defined
 * to have cosine 0 against anything, so classify() never divides by zero and
 * never crashes on an empty or zero embedding. Vectors shorter than a
 * prototype are read zero-padded; longer vectors are truncated to the first
 * EMBEDDING_DIMENSION entries.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const dimension = Math.min(EMBEDDING_DIMENSION, Math.max(a.length, b.length))
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < dimension; i += 1) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  if (normA === 0) {
    return 0
  }
  if (normB === 0) {
    return 0
  }
  return dot / Math.sqrt(normA * normB)
}

/**
 * Classifies a prompt into a routing domain.
 *
 * Embeds the prompt with the caller-provided embedFn, scores it against each
 * prototype centroid, and returns the best-matching domain with its cosine
 * confidence clamped to [0, 1]. If even the best cosine falls below
 * LOW_CONFIDENCE_THRESHOLD, the task is routed to 'reasoning' as the fallback
 * tier, carrying the low confidence value. Never throws on zero/empty
 * embeddings (their cosine is 0, which is below the threshold).
 *
 * This function is a pure mapping of (prompt, embedFn) to a result: it reads
 * no state, holds no references to any conversation object, and mutates
 * nothing. Callers may rely on it being deterministic.
 */
export function classify(
  prompt: string,
  embedFn: (text: string) => number[],
): { readonly domain: TaskDomain; readonly confidence: number } {
  const embedding = embedFn(prompt)
  let bestDomain: CapableDomain = 'code'
  let bestCosine = -1
  for (const { domain, centroid } of DOMAIN_PROTOTYPES) {
    const similarity = cosineSimilarity(embedding, centroid)
    if (similarity > bestCosine) {
      bestCosine = similarity
      bestDomain = domain
    }
  }
  const confidence = Math.max(0, Math.min(1, bestCosine))
  const domain: TaskDomain = bestCosine < LOW_CONFIDENCE_THRESHOLD ? 'reasoning' : bestDomain
  return { domain, confidence }
}

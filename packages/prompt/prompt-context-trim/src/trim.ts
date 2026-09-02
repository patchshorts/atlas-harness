/**
 * Verbatim context-surface trimming (deletion-not-rewrite).
 *
 * The L4 layer of the prompt-lume cost-reduction system. When the rolling
 * conversation surface exceeds a byte threshold, trim it to the surviving
 * verbatim recent tail by DELETING the oldest lines — never rewriting them —
 * so the byte-stable cached core and the surviving lines keep their provider
 * cache-read path intact. A mandatory verbatim floor (`retainFloorBytes`)
 * stops deletion from ever cutting into the most-recent working surface;
 * when even the floor alone would still exceed the threshold, no deletion can
 * bring the surface under budget, so the caller must fall back to
 * summarization of the pruned head instead.
 *
 * @module @atlasai/atsh-prompt-context-trim/trim
 */

/** One line of the conversation surface, pre-measured. */
export interface SurfaceLine {
  /** Stable identity of the line within the surface (e.g. session seq). */
  readonly seq: number | string
  /** Verbatim text of the line. */
  readonly text: string
}

/** Input line carrying its measured byte size (filled by the trimmer). */
export interface MeasuredSurfaceLine extends SurfaceLine {
  /** UTF-8 byte size of `text`. */
  readonly bytes: number
}

/** Config for a single trim operation. */
export interface TrimOptions {
  /** Byte threshold: trimming triggers only when the total surface exceeds this. */
  thresholdBytes: number
  /** Byte floor: the most-recent tail kept verbatim; deletion never cuts below it. */
  retainFloorBytes: number
  /** UTF-8 byte measure; defaults to `Buffer.byteLength`. */
  measure?: (text: string) => number
}

/** Outcome of one trim attempt. */
export type TrimResult =
  /** Surface already within the threshold — nothing was deleted. */
  | { readonly kind: 'none'; readonly surface: readonly MeasuredSurfaceLine[] }
  /**
   * Verbatim deletion brought the surface under the threshold. `surface` is
   * the surviving tail (oldest pruned lines removed, no line rewritten).
   */
  | {
    readonly kind: 'verbatim'
    readonly surface: readonly MeasuredSurfaceLine[]
    /** The oldest lines deleted by the trim. */
    readonly pruned: readonly MeasuredSurfaceLine[]
  }
  /**
   * Deletion cannot reach the threshold: even keeping only the floor tail
   * would exceed `thresholdBytes`. The caller must summarize `pruned` to land
   * a checkpoint and keep the floor tail verbatim.
   */
  | {
    readonly kind: 'summarize'
    /** All measured lines, unchanged (the caller chooses what to condense). */
    readonly surface: readonly MeasuredSurfaceLine[]
    /** The head span eligible for summarization; the floor tail stays verbatim. */
    readonly pruned: readonly MeasuredSurfaceLine[]
    /** The verbatim floor tail that must survive. */
    readonly retained: readonly MeasuredSurfaceLine[]
  }

/** Default UTF-8 byte measure. */
function utf8Length(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Trim the oldest conversation lines verbatim until the surface fits the
 * budget, honoring the verbatim floor.
 *
 * Deterministic and pure: never mutates the input surface, never rewrites a
 * line. The returned `surface` lines are the input objects (measured), so a
 * downstream provider prompt-cache read over the unchanged tail survives the
 * trim.
 *
 * @param surface - the rolling conversation surface, oldest first.
 * @param options - threshold, floor, and optional byte measure.
 * @returns the trim outcome (see {@link TrimResult}).
 */
export function trimSurface(
  surface: readonly SurfaceLine[],
  options: TrimOptions,
): TrimResult {
  const measure = options.measure ?? utf8Length
  const measured: MeasuredSurfaceLine[] = surface.map(line => ({
    ...line,
    bytes: measure(line.text),
  }))
  const total = measured.reduce((sum, line) => sum + line.bytes, 0)
  if (total <= options.thresholdBytes) return { kind: 'none', surface: measured }
  if (measured.length === 0) return { kind: 'none', surface: measured }

  // Walk from the tail to find the minimal verbatim floor suffix: the shortest
  // tail whose bytes reach retainFloorBytes. We never delete into this tail.
  let floorFrom = measured.length
  let floorSize = 0
  for (let index = measured.length - 1; index >= 0; index -= 1) {
    floorSize += measured[index]!.bytes
    floorFrom = index
    if (floorSize >= options.retainFloorBytes) break
  }
  const floorTail = measured.slice(floorFrom)

  // If even the minimal floor suffix exceeds the budget, no deletion can reach
  // it — the caller must summarize the pruned head instead.
  if (floorSize > options.thresholdBytes) {
    return {
      kind: 'summarize',
      surface: measured,
      pruned: measured.slice(0, floorFrom),
      retained: floorTail,
    }
  }

  // Otherwise keep the LONGEST suffix that fits the threshold. This suffix is
  // a superset of the floor tail (the floor tail already fits), so honoring
  // the floor is automatic. Continuing past this point would exceed the budget.
  let keepFrom = measured.length
  let keepSize = 0
  for (let index = measured.length - 1; index >= 0; index -= 1) {
    if (keepSize + measured[index]!.bytes > options.thresholdBytes) break
    keepSize += measured[index]!.bytes
    keepFrom = index
  }

  const pruned = measured.slice(0, keepFrom)
  const retained = measured.slice(keepFrom)

  if (pruned.length === 0) {
    // Whole surface is the floor and still over budget: nothing to delete.
    return { kind: 'summarize', surface: measured, pruned, retained: measured }
  }

  // Deleting the head brings the verbatim tail under the budget.
  return { kind: 'verbatim', surface: retained, pruned }
}

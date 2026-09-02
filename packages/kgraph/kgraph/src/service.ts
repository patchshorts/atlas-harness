/**
 * Service Definition for the OKR knowledge-graph capability seam (`ctx.kgraph`): an
 * abstract service defining WHAT a durable OKR graph does — upsert objectives, add key
 * results and evidence, build a graph from a session log, and report stats — without
 * saying HOW. Implementations subclass {@link KGraph} and register as the `kgraph`
 * service; the SQLite backend in this package is the default.
 *
 * The seam stays storage-agnostic: no graph engine, no traversal language, no schema
 * inference. A backend stores flat objective / key-result / evidence rows and exposes
 * the same model surface, so an agent gets durable OKR tracking on a zero-dependency
 * SQLite backend out of the box.
 *
 * @module @atlasai/atsh-kgraph/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AddEvidenceInput,
  AddKeyResultInput,
  Evidence,
  GraphBuildResult,
  KGraphStats,
  KeyResult,
  Objective,
  UpsertObjectiveInput,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    kgraph: KGraph
  }
}

/**
 * Abstract OKR knowledge-graph service. Subclass, implement the six operations, and
 * load the subclass as a plugin — it registers as `ctx.kgraph` (one implementation per
 * context; loading a second throws, cordis' standard duplicate-service behavior).
 *
 * Semantics every implementation must honor:
 * - {@link upsertObjective} creates a new objective when `id` is omitted and updates
 *   the matching row (name, description, status) when it is present.
 * - {@link listObjectives} returns all objectives with their key results attached.
 * - {@link addKeyResult} appends one key result to an existing objective.
 * - {@link addEvidence} persists one evidence row pointing at a session-log event;
 *   rows are unique per `(sessionId, seq)` so replays never duplicate.
 * - {@link buildGraphFromSession} derives objectives and evidence from one session log
 *   deterministically (no LLM judgment) and is idempotent per `(sessionId, seq)`.
 * - {@link getStats} reports aggregate row counts and the number of sessions ingested.
 */
export abstract class KGraph extends Service {
  constructor(ctx: Context) {
    super(ctx, 'kgraph')
  }

  /**
   * Create or update one objective.
   * @param input - name plus optional id (update) and description.
   * @returns the stored objective with its (possibly empty) key result list.
   */
  abstract upsertObjective(input: UpsertObjectiveInput): Promise<Objective>

  /**
   * List all objectives with their key results attached.
   * @returns objectives ordered by creation time, oldest first.
   */
  abstract listObjectives(): Promise<Objective[]>

  /**
   * Append one key result to an objective.
   * @param input - owning objective id plus the key result fields.
   * @returns the stored key result.
   */
  abstract addKeyResult(input: AddKeyResultInput): Promise<KeyResult>

  /**
   * Persist one evidence row pointing at a session-log event.
   * @param input - objective linkage plus the source event's identity and excerpt.
   * @returns the stored evidence row.
   */
  abstract addEvidence(input: AddEvidenceInput): Promise<Evidence>

  /**
   * Derive objectives and evidence from one session log.
   * @param sessionId - session whose log is ingested.
   * @returns counts of objectives and evidence added by THIS call (replays add none).
   */
  abstract buildGraphFromSession(sessionId: string): Promise<GraphBuildResult>

  /**
   * Report aggregate counts.
   * @returns objective / key-result / evidence counts plus sessions ingested.
   */
  abstract getStats(): Promise<KGraphStats>
}

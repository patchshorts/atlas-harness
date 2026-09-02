/**
 * OKR knowledge-graph capability for the DeepSeek Harness: the `ctx.kgraph` Service
 * Definition seam plus a default zero-dependency SQLite backend. Load this package as
 * a plugin to register `ctx.kgraph`:
 *
 * ```ts
 * await ctx.plugin(KGraphPlugin, { sqlite: { path: './kgraph.db' } })
 * ```
 *
 * The SQLite backend works out of the box with no external services. The autobuilder
 * (`buildGraphFromSession`) is a deterministic reader of the append-only session event
 * log: a `user/message` event seeds an objective, and `assistant/message` /
 * `tool/result` events become evidence rows.
 *
 * Model-facing tools over this seam live in `@atlasai/atsh-tool-kgraph`
 * (`kgraph_upsert_objective`, `kgraph_record_evidence`, `kgraph_query`).
 *
 * @module @atlasai/atsh-kgraph
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SqliteKGraphStore } from './sqlite.ts'
import type { KGraphConfig } from './types.ts'

export { KGraph } from './service.ts'
export { SqliteKGraphStore } from './sqlite.ts'
export type * from './types.ts'

/** Plugin display name (loader-facing). */
export const name = 'kgraph'

/** Plugin config: SQLite store settings plus the optional reader seam. */
export interface Config extends KGraphConfig {}

/** Schemastery configuration for the kgraph plugin. */
export const Config: z<Config> = z.object({
  sqlite: z.object({
    // Inner fields stay non-required: schemastery's object validator descends
    // into nested schemas and enforces inner `.required()` even when the parent
    // key is absent, which would reject every config without `path`.
    path: z.string(),
  }),
  reader: z.function(),
})

/**
 * Register the configured kgraph backend as `ctx.kgraph`. A second backend on the same
 * context throws cordis' standard duplicate-service error. The backend's constructor
 * runs synchronously, so `ctx.kgraph` is available as soon as this plugin's load settles.
 * @param ctx - registrant context.
 * @param config - validated plugin config; defaults to the SQLite `:memory:` backend.
 */
export function apply(ctx: Context, config: Config): void {
  void new SqliteKGraphStore(ctx, {
    ...(config.sqlite?.path !== undefined ? { path: config.sqlite.path } : {}),
    ...(config.reader !== undefined ? { reader: config.reader } : {}),
  })
}

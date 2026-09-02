/**
 * Semantic memory capability for the DeepSeek Harness: the `ctx.memoryStore` Service
 * Definition seam plus a default zero-dependency SQLite backend and a config-gated pgvector
 * adapter. Load this package as a plugin to register `ctx.memoryStore`:
 *
 * ```ts
 * await ctx.plugin(Memory, { backend: 'sqlite', sqlite: { path: './memory.db' } })
 * ```
 *
 * The `sqlite` backend (default) works out of the box with no external services; the
 * `pgvector` backend requires the operator to `pnpm add pg` and supply a Postgres with the
 * pgvector extension (see README.md).
 *
 * Model-facing tools over this seam live in `@atlasai/atsh-tool-memory`
 * (`memory_recall`, `memory_retain`, `memory_reflect`).
 *
 * @module @atlasai/atsh-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SqliteMemoryBackend } from './sqlite.ts'
import { PgVectorMemoryBackend } from './pgvector.ts'
import type { PgVectorConfig, SqliteConfig } from './types.ts'

export { MemoryStore } from './service.ts'
export { SqliteMemoryBackend } from './sqlite.ts'
export { PgVectorMemoryBackend } from './pgvector.ts'
export type * from './types.ts'

/** Plugin display name (loader-facing). */
export const name = 'memory'

/** Plugin config: backend selection plus per-backend settings (all optional; SQLite is the default). */
export interface Config {
  /** Storage backend; `'sqlite'` (default) needs no external services. */
  backend?: 'sqlite' | 'pgvector'
  /** SQLite backend settings. */
  sqlite?: SqliteConfig
  /** pgvector backend settings (required when `backend: 'pgvector'`). */
  pgvector?: PgVectorConfig
}

/** Schemastery configuration for the memory plugin. */
export const Config: z<Config> = z.object({
  backend: z.union([z.const('sqlite'), z.const('pgvector')]),
  sqlite: z.object({ path: z.string() }),
  pgvector: z.object({
    // Inner fields stay non-required: schemastery's object validator descends
    // into nested schemas and enforces inner `.required()` even when the parent
    // key is absent, which would reject every sqlite-only config. `apply()`
    // enforces connectionString when backend === 'pgvector'.
    connectionString: z.string(),
    table: z.string(),
    embed: z.function(),
  }),
})

/**
 * Register the configured memory backend as `ctx.memoryStore`. A second backend on the same
 * context throws cordis' standard duplicate-service error. The backend's constructor runs
 * synchronously, so `ctx.memoryStore` is available as soon as this plugin's load settles.
 * @param ctx - registrant context.
 * @param config - validated plugin config; defaults to the SQLite `:memory:` backend.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.backend === 'pgvector') {
    const pgvector = config.pgvector
    if (!pgvector) {
      throw new Error('dsh-memory: backend "pgvector" requires the pgvector config (connectionString)')
    }
    // Constructed directly (not via ctx.plugin) so registration is synchronous with apply.
    void new PgVectorMemoryBackend(ctx, pgvector)
  } else {
    void new SqliteMemoryBackend(ctx, config.sqlite ?? {})
  }
}

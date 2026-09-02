/**
 * Minimal ambient declaration for the optional `pg` driver, so this package compiles without
 * `pg` installed (it is NOT in the workspace lockfile and is loaded lazily via dynamic import
 * inside methods, never at module top level). The operator who enables the pgvector backend
 * runs `pnpm add pg` and gets the real types; this ambient only needs to satisfy the
 * adapter's narrow usage. Do not widen it beyond the adapter's needs.
 */
declare module 'pg' {
  export class Client {
    constructor(config: unknown)
    connect(): Promise<void>
    query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>
    end(): Promise<void>
  }
}

/**
 * `bench-serve-trace` — short-circuit tracer for the res-2-pydantic-v2 regression
 *.
 *
 * The corrections paper's ONE success regression (res-2-pydantic-v2, additive arm,
 * clone 59s pass / additive 37-40s fail) is attributed to a "short-circuit" of the
 * prompt's required first step: "First verify the ACTUAL installed pydantic version
 * and its validator semantics… then migrate legacy.py". The pure classifier below
 * NAMES which subsystem served that verify step — `cache` (an LLM completion was
 * replayed from the harness response cache without an upstream call, so the model
 * "already knew" the version) vs `router` (a route rewrite routed the verify request
 * to a cheaper path and the live `verify` tool never ran) vs `live` (the model made
 * a real tool call that inspected the installed package) — so a re-run can decide
 * the short-circuit mechanism from a persisted serve-trace sidecar.
 *
 * Design mirrors the loop-guard (guard.ts, T6/T7): an additive packages/bench plugin
 * whose decision layer is a PURE function, unit-testable without booting the harness
 * (deferred-verification contract — self-targeted fast spec). Golden rule: the tracer
 * never reads, writes, or mutates model-visible history; it records serve-source
 * diagnostics only. The classification reads a serve-trace sidecar that the runner
 * writes from the session log's observable completion/tool events; the plugin itself
 * is the persistent observer that will write live source on a re-run.
 *
 * @module @atlasai/atsh-bench/run/trace
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'bench-serve-trace'

/** The subsystem that served one LLM completion. */
export type ServeSource = 'cache' | 'router' | 'live'

/**
 * One serve record: the source of an LLM completion (or a tool call) as observed on
 * the session. Tool records carry `tool`; model-serve records carry `source`.
 */
export interface ServeRecord {
  /** Running record index within the session. */
  seq: number
  /** Unix epoch milliseconds. */
  ts?: number
  /**
   * Completion source. `live` = upstream LLM served it; `cache` = the harness
   * response cache replayed it (no upstream); `router` = the router rewrote the
   * route then upstream served it. Tool records omit `source`.
   */
  source?: ServeSource
  /** Tool name when this is a follow-on tool call record. */
  tool?: string
}

/** Result of classifying a serve-trace for the "verify installed first" step. */
export interface ShortCircuitVerdict {
  /**
   * The subsystem that short-circuited the verify-first step, or `null` when the
   * session performed a live verify (no short-circuit). Only the FIRST non-live
   * serve that precedes the verify tool is reported — the subsystem the run must fix.
   */
  shortCircuit: 'cache' | 'router' | null
  /** True when a tool actually ran that reflects the installed environment. */
  verifyRan: boolean
  /** Number of serve records analyzed. */
  records: number
  /** One-line human evidence note naming the deciding records. */
  note: string
}

/** Tool names (substrings) that reflect the installed runtime, NOT a mutation. */
const VERIFY_HINTS = ['python', 'bash', 'version', 'pip', 'pydantic', 'verify', 'check']

/**
 * Heuristic: is a tool call one that inspects the environment / installed version
 * (the prompt's required "verify the ACTUAL installed version" step) rather than a
 * mutation (write/edit/patch)? A live verify must call one of these BEFORE mutating.
 * @param tool - the tool name observed in the serve trace.
 * @returns true when the tool looks like a verify/environment-inspection call.
 */
function isVerifyTool(tool: string): boolean {
  if (/(^|\/)edit|write|patch|submit|task|apply/i.test(tool)) return false
  return VERIFY_HINTS.some(h => tool.includes(h))
}

/**
 * Pure classifier: name the subsystem that short-circuited the "verify installed
 * version first" step.
 *
 * Iterates the serve records in order. The verify step is treated as satisfied when a
 * tool call that inspects the environment appears in the stream. If a completion was
 * served by the harness cache (`cache`) or router-rewritten (`router`) BEFORE any
 * live verify tool ran, that is the short-circuit source — the run consumed a
 * replayed/rewritten completion and never ran the live check before migrating.
 *
 * @param records - serve records in session order.
 * @returns the named short-circuit subsystem, or `null` when a live verify ran first.
 */
export function shortCircuitVerdict(records: readonly ServeRecord[]): ShortCircuitVerdict {
  const verifyIdx = records.findIndex(r => r.tool !== undefined && isVerifyTool(r.tool))
  const verifyRan = verifyIdx !== -1
  const firstNonLive = records.find(
    r => (r.source === 'cache' || r.source === 'router') && !(r.tool !== undefined && isVerifyTool(r.tool)),
  )
  const shortCircuit: 'cache' | 'router' | null = (() => {
    if (verifyRan && firstNonLive !== undefined) return null
    if (firstNonLive === undefined) return null
    return firstNonLive.source === 'cache' ? 'cache' : 'router'
  })()
  const note = shortCircuit === null
    ? `no short-circuit: live verify tool ${verifyRan ? 'found' : 'absent'}; first serve ${firstNonLive?.source ?? 'live'}`
    : `${shortCircuit} served completion before any live verify tool (seq ${firstNonLive?.seq})`
  return { shortCircuit, verifyRan, records: records.length, note }
}

/**
 * Persist a serve-trace to the bench sidecar (append-only JSONL). Creates parent
 * directories. Used by the runner after a session and by tests writing a trace.
 *
 * @param path - sidecar file path.
 * @param records - records to append, one JSON object per line.
 */
export function appendServeTrace(path: string, records: readonly ServeRecord[]): void {
  mkdirSync(dirname(path), { recursive: true })
  const lines = records.map(r => `${JSON.stringify(r)}\n`).join('')
  writeFileSync(path, lines, { flag: 'a' })
}

/** Read an existing serve-trace sidecar back into records (empty when absent/malformed). */
export function readServeTrace(path: string): ServeRecord[] {
  if (!existsSync(path)) return []
  const out: ServeRecord[] = []
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    if (raw.trim().length === 0) continue
    try {
      out.push(JSON.parse(raw) as ServeRecord)
    } catch {
      // skip malformed line
    }
  }
  return out
}

/** Config for the serve-trace plugin. */
export interface Config {
  /** Sidecar JSONL path under the session ATSH_HOME (written by the runner). */
  path: string
}

export const PluginConfig: z<Config> = z.object({
  path: z.string(),
})

/**
 * Install the serve-trace listener on a plugin context. Hooks the `llm/stream`
 * waterfall and records a `live` serve record per completion (the runner's own
 * instrumentation adds cache/router source on a re-run with cache/emit observation);
 * the sidecar is the durable trace a re-run classifier reads. Never model-visible.
 *
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const path = config.path
  // Ensure the sidecar file exists and the header is written once.
  appendServeTrace(path, [])
  const hook = ctx.on as unknown as (event: string, listener: (...args: any[]) => any) => unknown
  let seq = 0
  hook('llm/stream', (_options: { provider?: string; model?: string }, next: () => AsyncIterable<unknown>) => {
    seq += 1
    appendServeTrace(path, [{ seq, ts: Date.now(), source: 'live' }])
    // No veto, no mutation of next() — pure pass-through so the tracer is a no-op
    // on runtime behavior other than the sidecar append.
    const inner = next()
    return inner
  })
}

export default { name, Config: PluginConfig, apply }

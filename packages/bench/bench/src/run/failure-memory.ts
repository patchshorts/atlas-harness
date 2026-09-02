/**
 * `bench-failure-memory` — failure-signature memory.
 *
 * The additive capability layer's memory starts empty per session and has
 * nothing to do on a one-turn task. This plugin gives memory a job that
 * exists on EVERY task: after any failed verify or errored tool result it
 * writes a NORMALISED failure signature (`tool`, `error code`, `target
 * path`, `clause`) to a within-session store, and checks the store BEFORE
 * repeating a call with the same signature.
 *
 * Keyed difference from the mistake ledger: the mistake ledger
 * pins a record per TOOL and vetoes any re-try of that tool, regardless of
 * how the failure differs. Failure-signature memory keys on the 4-FIELD
 * SIGNATURE, not the tool alone — so a re-issue of the same tool at the same
 * target path (the same failing action) is caught at the same signature, but
 * a different path / clause / tool is NOT a false-positive veto. It is the
 * finer-grained "don't re-derive the exact same lost path twice" lever.
 *
 * Golden rule (matches the guard / mistake-ledger / pre-execute ADD pattern):
 * the plugin never reads, writes, or mutates model-visible history. It
 * observes `tools/result` failures, records the normalised signature, and on
 * a pre-call check of a re-issued same-signature returns a vetoed tool result
 * carrying the recorded failure + a pivot directive (the model reads its own
 * recorded loss instead of re-deriving it). The decision layer is pure
 * functions, unit-testable without booting the harness.
 *
 * The plugin is an ADD (packages/bench); it never touches a frozen upstream
 * file. `writeHomePatch` mounts it arm-agnostically.
 *
 * @module @atlasai/atsh-bench/run/failure-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name (matches the home-patch insert row id). */
export const name = 'bench-failure-memory'

/** Config for the bench failure-signature memory plugin. */
export interface Config {
  /**
   * Optional override of the pivot directive embedded in a vetoed repeat of
   * a recorded same-signature call. Must instruct the model to STOP
   * re-issuing this exact failing call and pivot. Defaults to the built-in.
   */
  repeatDirectiveText?: string
}

export const Config: z<Config> = z.object({
  repeatDirectiveText: z.string().min(1),
})

/** One recorded failure signature (the normalised 4-field key + the loss). */
export interface FailureRecord {
  /** The tool whose call failed. */
  tool: string
  /** The tool result error code (best effort). */
  errorCode: string
  /** The target path the call operated on (best effort, '' when unknown). */
  targetPath: string
  /** The contract clause the call was serving (best effort, '' when unknown). */
  clause: string
  /** One-line failure reason captured at the tools/result boundary. */
  failure: string
}

/** The within-session failure-signature store: an immutable map of records. */
export interface FailureMemoryStore {
  /** Records keyed by normalised signature, in insertion order. */
  readonly bySignature: ReadonlyMap<string, FailureRecord>
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Diagnostic emitted when the failure-signature memory records a new
     * failure signature or vetoes a repeat of a recorded same-signature
     * call. Carries the tool, the failure, and the record count. Never
     * model-visible.
     * @param event - the failure-memory-pin payload.
     * @param event.tool - the tool whose failure was recorded / vetoed.
     * @param event.failure - the failure reason recorded on the signature.
     * @param event.records - count of recorded signatures in the store.
     * @param event.ts - emission timestamp (epoch ms).
     * @param event.directive - the pivot directive the veto embeds.
     * @mode emit
     */
    'bench/failure-memory-pin'(event: {
      tool: string
      failure?: string
      records: number
      ts: number
      directive?: string
    }): void
  }
}

/** The empty store. */
export const EMPTY_FAILURE_MEMORY: FailureMemoryStore = { bySignature: new Map() }

/** Normalise a signature field: lowercase, trim, collapse whitespace. */
function norm(field: string | undefined): string {
  return (field ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Build the canonical normalised failure signature: `tool|errorCode|target|
 * clause`, each field normalised (lowercase, trimmed, whitespace-collapsed).
 * Two calls with the same tool/error/target/clause yield the same key — the
 * exact repeat the memory must catch.
 *
 * @param tool - the tool that failed.
 * @param errorCode - the failure error code.
 * @param targetPath - the target path the call operated on ('' when unknown).
 * @param clause - the contract clause the call served ('' when unknown).
 * @returns the canonical signature key.
 */
export function failureSignature(
  tool: string,
  errorCode: string,
  targetPath: string,
  clause: string,
): string {
  return `${norm(tool)}|${norm(errorCode)}|${norm(targetPath)}|${norm(clause)}`
}

/**
 * Record a failure into a NEW store (immutable — the input is untouched).
 * Dedupes by normalised signature: the first failure of an exact signature
 * stays recorded (insert order preserved), exactly like the ledger's first-
 * failure-wins.
 *
 * @param store - the current store.
 * @param record - the failure to record.
 * @returns a new store containing the record.
 */
export function recordFailure(store: FailureMemoryStore, record: FailureRecord): FailureMemoryStore {
  const key = failureSignature(record.tool, record.errorCode, record.targetPath, record.clause)
  if (store.bySignature.has(key)) return store
  const next = new Map(store.bySignature)
  next.set(key, record)
  return { bySignature: next }
}

/**
 * Pre-call same-signature check: does the store already hold a failure with
 * the same TOOL, TARGET and CLAUSE as an about-to-run call? The error code
 * is excluded from the match because it is only known AFTER the call fails;
 * the same tool + target + clause is the "repeating a call with the same
 * signature" the spec requires. Returns the matching recorded signature key
 * when one exists, else undefined (a call with a fresh signature passes).
 *
 * @param store - the failure-memory store.
 * @param tool - the about-to-run tool.
 * @param targetPath - the target the call will operate on.
 * @param clause - the clause the call serves.
 * @param errorCode - optionally pin to one recorded error code (pre-call: '').
 * @returns the matching recorded signature, or undefined.
 */
export function checkSameSignature(
  store: FailureMemoryStore,
  tool: string,
  targetPath: string,
  clause: string,
  errorCode = '',
): string | undefined {
  const target = norm(targetPath)
  const wantClause = norm(clause)
  const wantError = norm(errorCode)
  for (const [key, record] of store.bySignature) {
    if (record.tool !== tool) continue
    if (target !== '' && norm(record.targetPath) !== target) continue
    if (wantClause !== '' && norm(record.clause) !== wantClause) continue
    if (wantError !== '' && norm(record.errorCode) !== wantError) continue
    return key
  }
  return undefined
}

/** Shared error code for the same-signature repeat veto. */
const VETO_CODE = 'SAME_SIGNATURE_VETOED'

/**
 * The built-in pivot directive. Embedded in a vetoed repeat of
 * a same-signature failure. Directs the model to READ the recorded failure
 * and pivot rather than re-deriving the exact same lost path.
 */
export const DEFAULT_SAME_SIGNATURE_DIRECTIVE =
  'This exact call (same target / clause) already failed this session and is ' +
  'recorded in failure memory. Read the recorded failed result above. Do NOT ' +
  're-issue this same call — every further identical call will be rejected. ' +
  'PIVOT: change the target, the clause being served, or the approach, using ' +
  'the recorded failure to avoid re-deriving the same lost path.'

/**
 * Build the vetoed tool result for a repeated same-signature call. The result
 * embeds the recorded failure + the directive, so the model reads its own
 * recorded loss at the re-issue boundary.
 *
 * @param record - the recorded failure.
 * @param directive - optional override of the repeat directive text.
 * @returns the vetoed tool result.
 */
export function failureMemoryVetoResult(
  record: FailureRecord,
  directive: string = DEFAULT_SAME_SIGNATURE_DIRECTIVE,
): ToolResult {
  const message =
    `bench-failure-memory vetoed the repeat of "${record.tool}" at ` +
    `"${record.targetPath || '<no-target>'}" (same failure signature recorded this session).`
  return {
    content: [
      {
        type: 'text',
        text: `Error: ${message}\n\nFAILURE MEMORY (this exact call already failed):\n` +
          `FAILED ${record.tool}: ${record.failure}\n\n${directive}`,
      },
    ],
    isError: true,
    error: { message, info: { name: 'SameSignatureVetoedError', code: VETO_CODE } },
  }
}

/** Minimal view of a tool result the plugin produces / reads. */
interface ToolResult {
  content: Array<{ type: string; text: string }>
  isError: boolean
  error?: { message: string; info: { name: string; code: string } }
}

/** Minimal view of a `tools/result` / `tools/execute` payload. */
interface ToolCall {
  name?: string
  args?: Record<string, unknown>
  error?: { message?: string; info?: { name?: string; code?: string } }
}

/** Best-effort extract the target path a tool call operated on ('' if none). */
export function targetPathOf(args: Record<string, unknown> | undefined | null): string {
  if (!args) return ''
  for (const key of ['path', 'target', 'cwd', 'file', 'filePath', 'dir']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return ''
}

/**
 * Install the failure-memory listeners on a plugin context. The harness mounts
 * this plugin via the bench home patch; listeners are disposed with the owning
 * context.
 *
 * `tools/result` — on an errored tool result, extract the normalised
 * signature (tool + error code + target path + clause) and record it.
 * `tools/execute` — BEFORE running a call, check the store for the same
 * signature; a re-issued identical call returns a veto  result with the
 * recorded failure + directive.
 *
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const directive = config.repeatDirectiveText ?? DEFAULT_SAME_SIGNATURE_DIRECTIVE
  // The within-session store: starts empty, only failures add to it.
  let store: FailureMemoryStore = EMPTY_FAILURE_MEMORY

  // Hook the organic harness waterfalls WITHOUT touching the shared cordis
  // Events interface (their real signatures live in dsh-tools; a competing
  // augmentation breaks `ctx.on` across the workspace).
  const hook = ctx.on as unknown as (
    event: string,
    listener: (...args: any[]) => any,
  ) => unknown

  const emitPin = (tool: string, failure: string, records: number): void => {
    ctx.emit('bench/failure-memory-pin', {
      tool,
      failure,
      records,
      ts: Date.now(),
      directive,
    })
  }

  // Record a failure on the RESULT boundary: an errored tool result is a
  // loss — normalise its signature into the within-session store.
  hook('tools/result', (exec: ToolCall, result: ToolResult) => {
    if (typeof exec.name !== 'string') return
    if (result.isError !== true) return
    const errorCode =
      typeof result.error?.info?.code === 'string'
        ? result.error.info.code
        : typeof result.error?.info?.name === 'string'
          ? result.error.info.name
          : 'error'
    const failure = typeof result.error?.message === 'string' && result.error.message.length > 0
      ? result.error.message
      : 'error result (no message)'
    const path = targetPathOf(exec.args)
    const record: FailureRecord = {
      tool: exec.name,
      errorCode,
      targetPath: path,
      clause: '',
      failure,
    }
    const next = recordFailure(store, record)
    if (next !== store) {
      store = next
      emitPin(exec.name, failure, store.bySignature.size)
    }
  })

  // Pre-call same-signature check: before a call runs, if the store already
  // holds a failure with the same tool + target + clause, veto it and embed
  // the recorded failure + directive (the model reads its own lost path).
  hook('tools/execute', (exec: ToolCall, next: () => Promise<unknown>) => {
    if (typeof exec.name !== 'string') return next()
    const path = targetPathOf(exec.args)
    const key = checkSameSignature(store, exec.name, path, '', '')
    if (key === undefined) return next()
    const record = store.bySignature.get(key)
    if (record === undefined) return next()
    emitPin(exec.name, record.failure, store.bySignature.size)
    return Promise.resolve(failureMemoryVetoResult(record, directive))
  })
}

export default { name, Config, apply }

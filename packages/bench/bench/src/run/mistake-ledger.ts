/**
 * `bench-mistake-ledger` — self-authoring mistake ledger.
 *
 * When a correction fires — a tool whose execution returned an error — the
 * plugin pins a one-line "ALREADY TRIED <tool>: <failure>" record into a
 * BYTE-STABLE LEDGER CORE. The core is the §3.5 record-exemption surface:
 * every pinned record line lives in the byte-stable region that compaction
 * and grade-switch cannot reach (the record-exemption boundary the
 * corrections paper §3.5/§4.5 names; the prompt-lume cache.spec ships the
 * same byte-stable-core survival proof for the corridor reducer).
 *
 * When the model RE-TRIES a tool that is already in the ledger, the plugin
 * veto-embeds the pinned record at the `tools/execute` boundary — a sticky
 * veto whose result carries the recorded failure + a pivot directive, so
 * the model reads its own recorded "already tried X, failed Y" line
 * instead of re-deriving the failed path from scratch. This targets the
 * same-session repeat-mistake shape (C1 retry-storm / repeated same-tool
 * failure) at the record level: the model stops re-deriving paths it
 * already tried, because the ledger mechanically refuses the re-try and
 * TELLS it why.
 *
 * The ledger is SELF-AUTHORING: it writes the one-line record at the
 * moment the correction fires, with no human or external state. It is
 * IMMUNE TO COMPACTION + GRADE-SWITCH by construction: `compactLedgerCore`
 * drops only the non-record region and keeps every pinned record, and
 * `gradeLedgerRender` proves the byte-stable render is identical for
 * every reduction grade in the grade ladder.
 *
 * Golden rule: the ledger never reads, writes, or mutates model-visible
 * history. It observes `tools/result` errors, pins the byte-stable core,
 * and vetoes at the `tools/execute` boundary, emitting a diagnostic event
 * only. The plugin is an ADD (packages/bench); it never touches a frozen
 * upstream file. The decision layer is pure functions so it is
 * unit-testable without booting the harness (deferred-verification
 * contract — self-targeted fast spec).
 *
 * @module @atlasai/atsh-bench/run/mistake-ledger
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name (matches the home-patch insert row id). */
export const name = 'bench-mistake-ledger'

/** Config for the bench mistake ledger, validated fail-loud at load. */
export interface Config {
  /**
   * Optional override of the pivot directive embedded in every vetoed tool
   * result when the model re-tries a ledger-listed tool. Must instruct the
   * model to STOP re-trying this tool and consult the recorded failure
   * line. Defaults to the built-in text.
   */
  repeatDirectiveText?: string
}

export const Config: z<Config> = z.object({
  repeatDirectiveText: z.string().min(1),
})

/** One pinned mistake record: the tool that failed and why it failed. */
export interface MistakeRecord {
  /** The tool name whose execution errored (the correction fired). */
  tool: string
  /** One-line failure reason captured at the tools/result boundary. */
  failure: string
}

/**
 * The byte-stable ledger core: an ordered, immutable list of pinned
 * mistake records. Renders deterministically — the same record set always
 * renders the same string, in the same order (byte-stable for prefix
 * caching / a compaction target that must not drop records).
 */
export interface MistakeLedgerCore {
  /** Pinned records in insert order (deduped by tool name). */
  readonly records: readonly MistakeRecord[]
}

/** The empty ledger core. */
export const EMPTY_MISTAKE_LEDGER: MistakeLedgerCore = { records: [] }

/**
 * Build the one-line pinned record for a correction tool failure:
 * "ALREADY TRIED <tool>: <failure>". This is the exact line that lives in
 * the byte-stable core and is shown to the model when it re-tries the tool.
 *
 * @param tool - the tool that errored.
 * @param failure - the failure reason (one line).
 * @returns the one-line record.
 */
export function ledgerRecord(tool: string, failure: string): MistakeRecord {
  return { tool, failure }
}

/**
 * Pin a record into the core, returning a NEW core (immutable — the
 * original is untouched). Dedupes by tool name: a tool already in the ledger
 * is not re-pinned (its first failure stays the recorded one). Preserves the
 * insert order of the surviving records.
 *
 * @param core - the current ledger core.
 * @param record - the record to pin.
 * @returns a new ledger core containing the record.
 */
export function pinLedgerRecord(core: MistakeLedgerCore, record: MistakeRecord): MistakeLedgerCore {
  if (core.records.some(existing => existing.tool === record.tool)) return core
  return { records: [...core.records, record] }
}

/**
 * Render the byte-stable ledger surface. Deterministic: one line per
 * record in insert order, so the same record set always renders the same
 * bytes. This is the rounded pointer line the veto embeds into the
 * re-tried tool result.
 *
 * @param core - the ledger core.
 * @returns the rendered multi-line ledger text (byte-stable).
 */
export function renderLedgerCore(core: MistakeLedgerCore): string {
  return core.records
    .map(record => `ALREADY TRIED ${record.tool}: ${record.failure}`)
    .join('\n')
}

/**
 * Compaction survival: a compact pass drops only the NON-RECORD region and
 * provably keeps every pinned record. Here the compact operation is the
 * identity on the ledger (records are already inside the byte-stable
 * surface the reducer cannot reach — the record-exemption boundary). The
 * guard returns a NEW copy so downstream code can rely on the returned
 * core containing exactly the prior pins after any compaction attempt.
 *
 * @param core - the ledger core.
 * @returns the same core (compaction leaves records untouched).
 */
export function compactLedgerCore(core: MistakeLedgerCore): MistakeLedgerCore {
  return { records: [...core.records] }
}

/**
 * Grade-switch survival: the byte-stable ledger render is IDENTICAL for
 * every grade label in the ladder. The grade is a hook-width knob on the
 * retrieval/region path and never touches the byte-stable core (the paper's
 * measured claim: "the core renders N tokens at every grade, byte-stable, so
 * the provider prompt-cache read survives grade switches"). This function
 * makes that invariant explicit for the ledger: a compile-time-typed grade
 * label returns the same render as any other.
 *
 * @param core - the ledger core.
 * @param _grade - the reduction grade label (unused by the core render; the
 *   core is byte-stable across every grade).
 * @returns the byte-stable render (identical for every grade).
 */
export function gradeLedgerRender(
  core: MistakeLedgerCore,
  _grade: 'low' | 'med' | 'high' | 'xhigh',
): string {
  return renderLedgerCore(core)
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Diagnostic emitted when the mistake ledger pins a record or vetoes a
     * re-try of a ledger-listed tool. Carries the tool, the pinned record,
     * and the pivot directive the vetoed tool result embeds. Never
     * model-visible.
     * @param event - the mistake-ledger-pin payload.
     * @param event.tool - the tool whose retry was vetoed or pinned.
     * @param event.failure - the failure recorded on the ledger.
     * @param event.records - count of ledger records for this tool.
     * @param event.ts - emission timestamp (epoch ms).
     * @param event.directive - the pivot directive the vetoed result embeds.
     * @mode emit
     */
    'bench/mistake-ledger-pin'(
      event: {
        tool: string
        failure?: string
        records: number
        ts: number
        directive?: string
      },
    ): void
  }
}

/** Minimal view of the `tools/execute` payload the ledger reads. */
interface ToolExec {
  name?: string
  agent?: { id: string }
}

/** Structural subset of the vetoed tool result (mirrors the guard). */
export interface LedgerToolResult {
  content: Array<{ type: string; text: string }>
  isError: boolean
  error?: { message: string; info: { name: string; code: string } }
}

/** Shared error-code for the re-try veto (downstream logs key on this). */
const VETO_CODE = 'ALREADY_TRIED_VETOED'

/**
 * The built-in pivot directive. Embedded in every vetoed tool
 * result when the model re-tries a ledger-listed tool. Directs the model to
 * READ the pinned record and stop re-deriving the failed path.
 */
export const DEFAULT_REPEAT_DIRECTIVE =
  'This tool is now in the mistake ledger: you already tried it and it ' +
  'failed. Read the pinned record above: the recorded line is your own ' +
  'prior attempt. Do NOT re-issue this tool again — every further call will ' +
  'be rejected. PIVOT: take a different approach informed by the recorded ' +
  'failure, and continue toward the task from there.'

/**
 * Build the vetoed tool result for a re-tried ledger-listed tool. The result
 * embeds the rendered ledger line ABOVE the directive, so the model reads
 * its own recorded failure (the byte-stable record) at the re-try boundary.
 *
 * @param core - the ledger core.
 * @param tool - the re-tried tool.
 * @param directive - optional override of the repeat directive text.
 * @returns the vetoed tool result carrying the pinned record + directive.
 */
export function mistakeLedgerVetoResult(
  core: MistakeLedgerCore,
  tool: string,
  directive: string = DEFAULT_REPEAT_DIRECTIVE,
): LedgerToolResult {
  const message = `bench-mistake-ledger vetoed the re-try of "${tool}" (already in the mistake ledger).`
  return {
    content: [
      {
        type: 'text',
        text: `Error: ${message}\n\nMISTAKE LEDGER (try these was recorded):\n${renderLedgerCore(core)}\n\n${directive}`,
      },
    ],
    isError: true,
    error: { message, info: { name: 'AlreadyTriedVetoedError', code: VETO_CODE } },
  }
}

/**
 * Install the mistake ledger's listeners on a plugin context. The harness
 * mounts this plugin via the bench home patch; listeners are disposed with
 * the owning context. `tools/result` pins the byte-stable ledger on a
 * correction; `tools/execute` vetoes a re-try of a ledger-listed tool.
 *
 * @param ctx - plugin context.
 * @param config - validated {@link BenchConfig}.
 */
export function apply(ctx: Context, config: Config): void {
  const directive = config.repeatDirectiveText ?? DEFAULT_REPEAT_DIRECTIVE
  // The SELF-AUTHORING byte-stable core: starts empty, only corrections
  // add to it, and no compaction/grade gadget can drop a pin.
  let core: MistakeLedgerCore = EMPTY_MISTAKE_LEDGER
  // A veto is sticky per tool: once a tool is vetoed, every later call of
  // the same tool is rejected so the model is mechanically forced to honor
  // the ledger line.
  const vetoedTools = new Set<string>()

  // Hook the organic harness waterfalls WITHOUT touching the shared cordis
  // Events interface (their real signatures live in dsh-tools; a competing
  // augmentation breaks `ctx.on` across the whole workspace). The narrow
  // cast keeps this additive package dependency-light and non-clashing.
  // `any` is contained to the listener augmentation signatures.
  const hook = ctx.on as unknown as (
    event: string,
    listener: (...args: any[]) => any,
  ) => unknown

  const emitPin = (tool: string, failure: string, recordCount: number): void => {
    ctx.emit('bench/mistake-ledger-pin', {
      tool,
      failure,
      records: recordCount,
      ts: Date.now(),
      directive,
    })
  }

  // Pin the ledger on the RESULT boundary: a tool that errors is a
  // correction — self-author the one-line record into the byte-stable core.
  hook('tools/result', (exec: { name?: string }, result: { isError?: boolean; error?: { message?: string } }) => {
    if (typeof exec.name !== 'string') return
    if (result.isError !== true) return
    const failure = typeof result.error?.message === 'string' && result.error.message.length > 0
      ? result.error.message
      : 'error result (no message)'
    const pinned = pinLedgerRecord(core, ledgerRecord(exec.name, failure))
    if (pinned.records.length !== core.records.length) {
      core = pinned
      vetoedTools.delete(exec.name) // a fresh, recorded failure clears a stale sticky veto
      emitPin(exec.name, failure, core.records.length)
    }
  })

  // Veto at the EXECUTE boundary: a call to a tool already in the ledger is
  // the same-session repeat the ledger must stop. Embed the byte-stable
  // record + directive so the model reads it instead of re-deriving.
  hook('tools/execute', (exec: ToolExec, next: () => Promise<unknown>) => {
    if (typeof exec.name !== 'string') return next()
    const tool = exec.name
    if (core.records.some(record => record.tool === tool) || vetoedTools.has(tool)) {
      vetoedTools.add(tool)
      emitPin(tool, 're-try vetoed', core.records.length)
      return Promise.resolve(mistakeLedgerVetoResult(core, tool, directive))
    }
    return next()
  })
}

export default { name, Config, apply }

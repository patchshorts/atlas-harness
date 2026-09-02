/**
 * `bench-pre-execute` — contract pre-flight checklist.
 *
 * Generalises what makes `rv-27/28/29` (contract-cliff tasks) work: before the
 * first `edit` on a task, the plugin reads the CONTRACT-BEARING SOURCE — the
 * target file's docstring or a named policy file — extracts every imperative
 * clause, and emits them as a checklist event. Before the session concludes it
 * diffs the checklist against what the VISIBLE tests exercise and surfaces any
 * clause with no corresponding test.
 *
 * This is the §4.2 mechanism behind all three contract-cliff wins, applied to
 * every contract-bearing task rather than the three where the omission happens
 * to cause a loop: the model is told, up front and in its own tool stream,
 * exactly which clauses the verifier will hold it to — and the session-close
 * diff names the clauses the visible tests do NOT cover, so a sub-contract
 * implementation cannot slip past as "tests pass".
 *
 * It is deterministic, costs zero model calls, and is unit-testable.
 *
 * Golden rule (matches the loop-guard / mistake-ledger / verify-required ADD
 * pattern): the plugin never reads, writes, or mutates model-visible history.
 * It observes the `tools/execute` boundary on the first edit, emits a
 * diagnostic checklist event, and appends a directive to the first edit's tool
 * result (the model sees the contract lying flat in its own result stream —
 * the same lever the mistake-ledger veto uses). The decision layer is pure
 * functions, unit-testable without booting the harness.
 *
 * The plugin is an ADD (packages/bench); it never touches a frozen upstream
 * file.
 *
 * @module @atlasai/atsh-bench/run/pre-execute
 */

import type { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name (matches the home-patch insert row id). */
export const name = 'bench-pre-execute'

/** Config for the bench pre-execute plugin, validated fail-loud at load. */
export interface Config {
  /**
   * Relative path (within the sandbox working tree) to the contract-bearing
   * source: the file whose docstring IS the task contract, or a named policy
   * file. Read once before the first edit.
   */
  contractPath: string
  /**
   * Relative path (within the sandbox working tree) to the visible test file
   * (or directory) whose passing tests the verifier runs. Read once to diff
   * the checklist against actual coverage before the session concludes.
   */
  testsPath: string
  /**
   * Optional override of the contract-checklist directive appended to the
   * first edit's tool result. Defaults to the built-in text.
   */
  directiveText?: string
}

export const Config: z<Config> = z.object({
  contractPath: z.string().min(1),
  testsPath: z.string().min(1),
  directiveText: z.string().min(1),
})

/** One imperative clause extracted from the contract source. */
export interface ContractClause {
  /** The verb-led clause text, normalised (trimmed, no leading bullet). */
  text: string
}

/** Result of extracting imperative clauses from a contract source. */
export interface ContractChecklist {
  /** The clauses in source order. */
  clauses: ContractClause[]
  /** True when the source was non-empty and at least one clause was found. */
  found: boolean
}

/** One clause annotated with whether a visible test exercises it. */
export interface CoveredClause {
  clause: ContractClause
  /** True when at least one distinctive clause token appears in test source. */
  coveredByTest: boolean
}

/** Result of diffing the checklist against the visible-test source text. */
export interface CoverageDiff {
  /** Every clause, annotated with its coverage status. */
  rows: CoveredClause[]
  /** Only the clauses with NO corresponding visible test. */
  uncovered: ContractClause[]
}

/** Words too common to count as a distinctive clause signal. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'and', 'or', 'for', 'on', 'in', 'with',
  'must', 'should', 'shall', 'when', 'if', 'is', 'are', 'be', 'not', 'do',
  'does', 'return', 'returns', 'raise', 'raises', 'list', 'each', 'its',
])

/** Split contract source (docstring or policy file) into imperative clauses. */
export function extractImperativeClauses(source: string): ContractChecklist {
  const clauses: ContractClause[] = []
  for (const rawLine of source.split('\n')) {
    // Drop the leading bullet/dash from "  - raise ValueError when size <= 0."
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()
    if (line.length === 0) continue
    if (/^['"]/.test(line)) continue // docstring fence or opening quote
    clauses.push({ text: line })
  }
  return clauses.length > 0 ? { clauses, found: true } : { clauses, found: false }
}

/** Render the checklist as a flat, model-readable block. */
export function buildContractChecklist(checklist: ContractChecklist): string {
  if (checklist.clauses.length === 0) return 'CONTRACT CHECKLIST: no imperative clauses found.'
  const items = checklist.clauses
    .map((clause, i) => `${i + 1}. ${clause.text}`)
    .join('\n')
  return `CONTRACT CHECKLIST (binding — implement every clause):\n${items}`
}

/**
 * The default directive appended to the first edit's tool result. Tells the
 * model the checklist is binding and the verifier holds it to each clause.
 */
export const DEFAULT_DIRECTIVE_TEXT =
  'Begin this edit by satisfying EVERY line of the contract checklist above. ' +
  'The verifier checks the full contract, not just the happy-path visible tests.'

/** Distinctive whitespace tokens of a clause (drop stopwords). */
function clauseTokens(clause: string): string[] {
  return clause
    .split(/[^A-Za-z0-9_.]+/)
    .map(tok => tok.trim())
    .filter(tok => tok.length > 1)
    .filter(tok => !STOPWORDS.has(tok.toLowerCase()))
}

/**
 * Diff the contract checklist against the visible-test source text. A clause
 * is considered covered when at least one of its distinctive tokens appears in
 * the test source (case-insensitive substring, identifiers matched literally).
 *
 * @param checklist - the extracted checklist.
 * @param testSource - the visible test file(s) text the verifier actually runs.
 * @returns the per-clause coverage + the uncovered subset.
 */
export function diffChecklistCoverage(
  checklist: ContractChecklist,
  testSource: string,
): CoverageDiff {
  const lowerTest = testSource.toLowerCase()
  const rows: CoveredClause[] = checklist.clauses.map((clause) => {
    const tokens = clauseTokens(clause.text)
    const coveredByTest = tokens.some(token =>
      token !== undefined && lowerTest.includes(token.toLowerCase()),
    )
    return { clause, coveredByTest }
  })
  const uncovered = rows
    .filter(row => !row.coveredByTest)
    .map(row => row.clause)
  return { rows, uncovered }
}

/** Render the uncovered-clause diff as a model-readable block. */
export function renderCoverageDiff(diff: CoverageDiff): string {
  if (diff.uncovered.length === 0) {
    return 'CONTRACT COVERAGE: every clause has a corresponding visible test.'
  }
  const items = diff.uncovered
    .map((clause, i) => `${i + 1}. ${clause.text}`)
    .join('\n')
  return `CONTRACT GAP — no visible test covers these clauses (the verifier checks them anyway):\n${items}`
}

/** The diagnostic event name (typeless — additive plugin augments the map). */
export const CHECKLIST_EVENT = 'bench/contract-checklist'
export const COVERAGE_EVENT = 'bench/contract-coverage'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Diagnostic emitted when the contract pre-flight reads the contract
     * source on the first edit. Carries the extracted clause count and the
     * rendered checklist. Never model-visible.
     * @param event - the contract-checklist payload.
     * @param event.clauseCount - imperative clauses extracted.
     * @param event.source - the contract file path read.
     * @param event.checklist - the rendered checklist block.
     * @param event.ts - emission timestamp (epoch ms).
     * @mode emit
     */
    'bench/contract-checklist'(event: {
      clauseCount: number
      source: string
      checklist: string
      ts: number
    }): void
    /**
     * Diagnostic emitted when the session is closing: name the clauses the
     * visible tests do NOT cover (the §4.2 gap the verifier still enforces).
     * @param event - the contract-coverage payload.
     * @param event.uncoveredCount - clauses with no visible test.
     * @param event.report - the rendered coverage-diff block.
     * @param event.ts - emission timestamp (epoch ms).
     * @mode emit
     */
    'bench/contract-coverage'(event: {
      uncoveredCount: number
      report: string
      ts: number
    }): void
  }
}

/** Minimal view of the `tools/execute` payload the pre-flight reads. */
interface ToolExec {
  name?: string
}

/** Minimal view of the first-edit tool result the directive appends to. */
interface ToolResult {
  content: Array<{ type: string; text: string }>
  isError: boolean
  error?: { message: string; info: { name: string; code: string } }
}

/**
 * Append the contract directive to an existing tool result, returning a NEW
 * result (the input is untouched). Empty checklist -> no directive appended so
 * an unreadable contract never injects noise.
 */
export function appendPreFlightDirective(
  result: ToolResult,
  checklist: string,
  directive: string = DEFAULT_DIRECTIVE_TEXT,
): ToolResult {
  if (!checklist || checklist.startsWith('CONTRACT CHECKLIST: no imperative')) return result
  const content = Array.isArray(result.content)
    ? [...result.content, { type: 'text', text: `${checklist}\n\n${directive}` }]
    : [{ type: 'text', text: `${checklist}\n\n${directive}` }]
  return { ...result, content }
}

/**
 * Read the contract + test sources from the sandbox working tree and produce
 * the pre-flight payload. Kept as a separate helper so the plugin's apply() is
 * a thin shell and the read/dispatch logic is itself reachable.
 *
 * @param contractPath - sandbox-relative path to the contract source.
 * @param testsPath - sandbox-relative path to the visible test file/dir.
 * @returns the checklist + the coverage diff against the test source.
 */
export function readContractAndDiff(
  contractPath: string,
  testsPath: string,
): { checklist: ContractChecklist; diff: CoverageDiff } {
  const contractSource = readFileSync(contractPath, 'utf8')
  const testSource = readFileSync(testsPath, 'utf8')
  const checklist = extractImperativeClauses(contractSource)
  const diff = diffChecklistCoverage(checklist, testSource)
  return { checklist, diff }
}

/**
 * Install the pre-flight listeners on a plugin context. The harness mounts
 * this plugin via the bench home patch; listeners are disposed with the owning
 * context.
 *
 * On the FIRST edit tool call it reads the contract source, extracts the
 * checklist, emits the checklist event, and appends the checklist + directive
 * to that edit's real result (an advisory, not a stop — the edit still runs).
 * On a close signal it diffs the checklist against the visible tests and emits
 * the uncovered-clause gap.
 *
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const directive = config.directiveText ?? DEFAULT_DIRECTIVE_TEXT
  // The first edit fires the once-per-session checklist emit + directive.
  let firedFirstEdit = false
  let checklist: ContractChecklist = { clauses: [], found: false }

  // Hook the organic harness waterfalls WITHOUT touching the shared cordis
  // Events interface (their real signatures live in dsh-tools; a competing
  // augmentation breaks `ctx.on` across the whole workspace). `any` is
  // contained to the listener args.
  const hook = ctx.on as unknown as (
    event: string,
    listener: (...args: any[]) => any,
  ) => unknown

  // Emit the checklist diagnostic; never model-visible.
  const emitChecklist = (): void => {
    ctx.emit(CHECKLIST_EVENT, {
      clauseCount: checklist.clauses.length,
      source: config.contractPath,
      checklist: buildContractChecklist(checklist),
      ts: Date.now(),
    })
  }

  hook('tools/execute', (exec: ToolExec, next: () => Promise<unknown>) => {
    const tool = exec.name
    // Only fire the pre-flight on an EDIT — never on a read, test, or shell
    // call. Unknown tool name is treated as non-edit and passes through.
    if (tool !== 'edit' && tool !== 'write' && tool !== 'apply_patch') return next()
    if (!firedFirstEdit) {
      firedFirstEdit = true
      try {
        const pre = readContractAndDiff(config.contractPath, config.testsPath)
        checklist = pre.checklist
        emitChecklist()
        // Append the checklist + directive to the first edit's REAL result so
        // the model sees the binding clauses in its own tool stream.
        return next().then(result =>
          appendPreFlightDirective(result as ToolResult, buildContractChecklist(checklist), directive),
        )
      } catch {
        // Contract source unreadable (file missing in the sandbox) -> stay
        // silent; the edit proceeds untouched.
        checklist = { clauses: [], found: false }
        return next()
      }
    }
    return next()
  })

  // Session-close: diff the checklist against the visible-test coverage and
  // emit the uncovered-clause gap. The final no-tool assistant message is the
  // agent-loop's "completed" signal (the same seam the guard's fallback
  // depends on). We observe tool boundaries only — no history is touched.
  hook('agent/message', (msg: { role?: string; content?: string }) => {
    if (firedFirstEdit && msg?.role === 'assistant') {
      try {
        const testSource = readFileSync(config.testsPath, 'utf8')
        const diff = diffChecklistCoverage(checklist, testSource)
        ctx.emit(COVERAGE_EVENT, {
          uncoveredCount: diff.uncovered.length,
          report: renderCoverageDiff(diff),
          ts: Date.now(),
        })
      } catch {
        // tests path unreadable at close -> stay silent.
      }
    }
  })
}

export default { name, Config, apply }

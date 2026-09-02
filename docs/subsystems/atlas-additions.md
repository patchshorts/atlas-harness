# Atlas additions

English | [中文](atlas-additions.zh.md)

The additive capability families this fork hangs off the upstream harness spine (see [UPSTREAM.md](../../UPSTREAM.md) for the pinned upstream SHA). Each family is a new package under `packages/`, registers its own `ctx.*` service key through Cordis declaration merging, and is composed via additive rows in the bundle patch layer and the standard preset. The frozen upstream spine (`vendor/`, `packages/core`, `packages/session`, `packages/compaction`, `packages/preset`) is never modified; the frozen-file manifest (`FROZEN_FILES.sha256`) proves it byte-identical.

The service keys map to package sources as follows:

| `ctx` key | Package | Purpose |
|---|---|---|
| `memoryStore` | `packages/memory/memory` | Semantic memory seam (SQLite default, pgvector config-gated) with recall/retain/reflect tools |
| `llmRouter` | `packages/router/router` | Capability-gated routing over the `llm/stream` waterfall with a persisted call log |
| `routerTrainer` | `packages/router/trainer` | Training-sample queue consuming `router/call-logged` |
| `llmCache` | `packages/cache/cache` | Exact-hash + semantic cache tiers over the LLM call surface |
| `kgraph` | `packages/kgraph/kgraph` | OKR knowledge-graph seam with session autobuilder |
| `accounting` | `packages/accounting/accounting` | Token ledger, credit grants, and budget caps at the tool boundary |
| `coordination` | `packages/coordination/coordination` | C2 over the existing subagent registry + shared-state channels |
| `research` | `packages/research/research` | xurl post search + arXiv paper search/fetch |
| `factory` | `packages/factory/factory` | Plan-contract registry, deterministic BAR critic, role objectives for the ralph tool |
| `skills` (corpus) | `packages/skill/skill-corpus` | 208 flattened SKILL.md files exposed through the skill provider |

Event scopes `accounting/*`, `cache/*`, `coordination/*`, `factory/*`, `research/*`, and `router/*` are emitted by these families; their payload types are owned by each package's `src/types.ts`.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxaccounting--accountingservice"></a>

### `ctx.accounting` — `AccountingService`

Token accounting ledger. Load as a plugin (`ctx.plugin(AccountingService, config)`); it registers as `ctx.accounting` (one ledger per context — loading a second throws, cordis' standard duplicate-service behavior) and, when enabled, listens on the `llm/stream` waterfall (debits) and the `tools/execute` waterfall (budget-cap vetoes). The SQLite backend closes when the owning fiber unloads.

```ts cordis-catalog
/**
 * Credit an account: upsert its `accounts` row (`balance += amount`), append
 * a `'grant'` ledger row, and emit `accounting/grant`.
 * @param amount - token count to grant (positive).
 * @param reason - why the grant was written (surfaced in the ledger row).
 * @param account - account id (default `'default'`).
 * @returns the account balance after the grant.
 */
grant(amount: number, reason: string, account: string = 'default'): number

/**
 * Charge an account: append a `'debit'` ledger row (negative amount) and emit
 * `accounting/debit`. The public entry point for non-llm charges (e.g. judge
 * replan cost); identical ledger semantics to the intercepted `llm/stream` debits.
 * @param account - account id to charge.
 * @param amount - token count to charge (positive; the ledger row is negative).
 * @param reason - why the charge was written (surfaced in the ledger row).
 * @param meta - free-form metadata for the ledger row.
 * @throws {TypeError} When amount is not a positive finite number.
 */
charge(account: string, amount: number, reason: string, meta: Record<string, unknown>): void

/**
 * Read an account's current balance; `0` when no account row exists.
 * @param account - account id (default `'default'`).
 * @returns the account's current balance.
 */
getBalance(account: string = 'default'): number

/**
 * Total debit spend for an account: the sum of |amount| of its debit rows.
 * @param account - account id (default `'default'`).
 * @returns the account's total debit spend.
 */
spendFor(account: string = 'default'): number

/**
 * Read the most recent ledger rows, newest first.
 * @param limit - maximum rows to return (default 50).
 * @returns hydrated ledger rows.
 */
listLedger(limit: number = 50): LedgerRow[]

/**
 * Snapshot of the ledger's table-level counters.
 * @returns the grant/debit/account row counts.
 */
getStats(): AccountingStats
```

Source: [`packages/accounting/accounting/src/service.ts:124`](../../packages/accounting/accounting/src/service.ts)

<a id="ctxbench--benchservice"></a>

### `ctx.bench` — `BenchService`

The bench service seam's public surface. Registers `ctx.bench` and exposes the frozen per-run configuration for the deterministic C1..C5 correction classification and N-sessions-per-arm runner added by the the bench workstream tasks. Carries no behavior yet — it is the ADD-only scaffold later bench tasks build on; classification stays deterministic rules, never LLM judgment.

Source: [`packages/bench/bench/src/service.ts:45`](../../packages/bench/bench/src/service.ts)

<a id="ctxbudgetrouter--budgetrouterservice"></a>

### `ctx.budgetRouter` — `BudgetRouterService`

The Fix 2 + Fix 9 seam: hard token budget enforced by accounting, per-stage model routing with cumulative cost conditioning, batch prompting for shared system prompts, and cost reported alongside pass rate.

Golden-rule guarantee: the service holds no model-visible state and never writes to `options.messages`/`options.system` — route decisions rewrite only `provider`/`model` metadata on non-frozen requests, so the request prefix is byte-identical across stages (prefix-cache-friendly history).

```ts cordis-catalog
/**
 * Read the spend/budget/remaining snapshot for one account.
 *
 * Spend comes from accounting's ledger via `ctx.get` (0 when accounting is
 * not mounted); the budget comes from this service's config.
 *
 * @param account - the account id (`options.sessionId ?? 'default'` for llm calls).
 * @returns spend, configured budget (0 when unconfigured), and remaining
 *   (`max(0, budget - spend)`).
 */
budgetState(account: string): { spend: number; budget: number; remaining: number }

/**
 * Resolve the route for a stage at a cumulative cost.
 *
 * @param stage - the stage key ('general', ...).
 * @param cumulativeCost - cumulative spend for the account/stage.
 * @returns the selected tier, or `undefined` when the stage has no ladder.
 * @throws {Error} When the service is disabled.
 */
routeForStage(stage: string, cumulativeCost: number): StageRoute | undefined

/**
 * Plan batches by grouping requests that share the identical system prompt.
 *
 * @param requests - the requests to group; only `system` is read.
 * @returns the grouping plan plus estimated cache-read savings, or an empty
 *   plan when batch prompting is disabled.
 * @throws {Error} When the service is disabled.
 */
planBatches(requests: BatchRequest[]): BatchPlan

/**
 * Price a usage record with the merged model cost (pinned DeepSeek
 * constants overridden by `config.modelCost`).
 *
 * @param usage - token counts; cache-read/write tokens default 0.
 * @returns USD cost (never negative; 0 on empty usage).
 */
price(usage: Parameters<typeof priceTokens>[0]): number

/**
 * Report cost alongside pass rate for a batch of entries.
 *
 * Entries may carry `cachedTokens`/`uncachedTokens` meta (accessed via
 * `entry['cachedTokens'] ?? 0` / `entry['uncachedTokens'] ?? 0`), summed
 * into the report for the cache-hit-rate.
 *
 * @param entries - one entry per finished call: id, USD cost, and pass flag.
 * @returns totals, passRate (0 when totalCount is 0), costPerPassUsd (0
 *   when passCount is 0), and the cache-hit rate (0 when no tokens).
 */
reportCostAndPassRate(entries: CostReportEntry[]): CostReport

/**
 * The computed input/cacheRead price gap for the merged model cost.
 *
 * @returns `input / cacheRead` when `cacheRead > 0`, else `NaN`.
 */
cacheRatio(): number
```

Source: [`packages/factory/factory-budget-router/src/service.ts:58`](../../packages/factory/factory-budget-router/src/service.ts)

<a id="ctxcontextdebt--contextdebtservice"></a>

### `ctx.contextDebt` — `ContextDebtService`

The context-debt management seam: retrieval over stuffing, fold-only compaction plans, positional placement.

Stateless by design: the fold is a pure function and the JSONL log is the only state — this service never writes it. Golden rule: every call reads the committed snapshot (`session.events`, frozen) and returns derived values; the log stays byte-identical after any scan/plan/report call.

```ts cordis-catalog
/**
 * Scan a session's committed events for context debt: a `'stuffed'` report
 * when non-essential context (tool results, verbatim logs) exceeds the
 * configured threshold, plus `'positioned'` reports for content outside the
 * critical head/tail bands. Pure read: the log is never touched.
 *
 * @param session - the live session; its frozen committed snapshot is read.
 * @returns the scan result, reflecting the last committed seq.
 * @throws {Error} When the service is disabled (`'context-debt disabled'`).
 * @emits context-debt/scan
 */
scan(session: Session): ContextDebtScan

/**
 * Produce a fold-only compaction plan for a session: `foldSummary` over the
 * committed events → summary; the shadowed range is the stuffed span (the
 * whole committed range when nothing is stuffed); shadowedSeqs and count
 * come from the same span; `foldOnly` is ALWAYS `true`. The plan is a
 * derived value — the log is never rewritten.
 *
 * @param session - the live session; its frozen committed snapshot is read.
 * @param budgetTokens - the summary token budget for the fold.
 * @returns the fold-only plan; `isFoldOnly(plan, lastCommittedSeq)` holds.
 * @throws {Error} When the service is disabled (`'context-debt disabled'`).
 * @emits context-debt/plan
 */
plan(session: Session, budgetTokens: number): CompactionPlan

/**
 * One-line report string for a plan, for observability and accounting.
 *
 * @param plan - the plan to describe.
 * @returns a single-line, deterministic description of the plan.
 */
report(plan: CompactionPlan): string

/**
 * Split a plan's summary into the critical head and tail bands per
 * positional placement: leading lines fill the head band up to the
 * configured head token budget, trailing lines fill the tail band up to the
 * configured tail token budget, and the middle is dropped — critical
 * context lands at head/tail. Assembly of the actual model-visible context
 * from these bands is the caller's wiring.
 *
 * @param plan - the plan whose summary is split.
 * @returns the head and tail band line arrays (deterministic order).
 */
reposition(plan: CompactionPlan): { head: string[]; tail: string[] }
```

Types: [Session](session.md)

Source: [`packages/session/session-context-debt/src/service.ts:48`](../../packages/session/session-context-debt/src/service.ts)

<a id="ctxcoordination--coordinationservice"></a>

### `ctx.coordination` — `CoordinationService`

C2 orchestration service. Load as a plugin (`ctx.plugin(CoordinationService, config)`); it registers as `ctx.coordination` (one per context — loading a second throws, cordis' standard duplicate-service behavior) and requires the subagent registry (`ctx.subagents`), which it consumes but never modifies. The SQLite backend closes when the owning fiber unloads.

```ts cordis-catalog
/**
 * Spawn one subagent worker on the named provider and record its lifecycle
 * in the `coord_workers` table. The row is inserted as `'running'` before
 * the run settles; this resolves only after the run does, with the row
 * flipped to `'completed'` (outcome = joined text output, or
 * `JSON.stringify(structured)` when the run returned one) or `'failed'`
 * (outcome = the error text). Emits `coordination/worker-started` after the
 * row lands and `coordination/worker-completed` after the update lands.
 * @param provider - a registered subagent provider name.
 * @param request - the subagent delegation request (label, prompt, parent, signal).
 * @returns the worker record id.
 * @throws when the provider is not registered or coordination is disabled.
 */
async spawnWorker(provider: string, request: SubagentStartRequest): Promise<string>

/**
 * Read one worker record by id.
 * @param id - the worker record id returned by {@link spawnWorker}.
 * @returns the hydrated record, or `undefined` when no such row exists.
 */
getWorker(id: string): WorkerRecord | undefined

/**
 * List worker records, optionally filtered by status, newest first.
 * @param status - optional status filter.
 * @returns hydrated worker records.
 */
listWorkers(status?: WorkerStatus): WorkerRecord[]

/**
 * Snapshot of the coordination tables' counters.
 * @returns the worker/channel row counts.
 */
getStats(): CoordinationStats

/**
 * Write one shared-state entry, bumping the per-(channel, key) revision
 * monotonically (starting at 1) and upserting the row.
 * @param channel - channel name.
 * @param key - entry key within the channel.
 * @param value - JSON-serializable value; `undefined` and functions reject.
 * @returns the new revision.
 * @throws {TypeError} when the value cannot be JSON-serialized.
 * @throws when coordination is disabled.
 */
postState(channel: string, key: string, value: unknown): { revision: number }

/**
 * Read one shared-state entry.
 * @param channel - channel name.
 * @param key - entry key within the channel.
 * @returns the hydrated entry, or `undefined` when absent.
 */
getState(channel: string, key: string): SharedStateEntry | undefined

/**
 * List one channel's entries ordered by revision.
 * @param channel - channel name.
 * @returns hydrated entries in write order.
 */
listChannel(channel: string): SharedStateEntry[]
```

Types: [SubagentStartRequest](subagent.md)

Source: [`packages/coordination/coordination/src/service.ts:136`](../../packages/coordination/coordination/src/service.ts)

<a id="ctxfactory--factoryservice"></a>

### `ctx.factory` — `FactoryService`

The factory seam: plan-contract registry, deterministic BAR critic scoring, and immutable role objectives for the ralph tool.

```ts cordis-catalog
/**
 * Register (or replace) the atomic-task contract for a plan id.
 *
 * @param planId - The plan id, a non-empty normalized string.
 * @param tasks - The atomic tasks, at least one, each with normalized
 *   id/verb/object/verifies fields and unique ids, at most maxPlanTasks.
 * @throws {Error} When the service is disabled.
 * @throws {TypeError} When the plan id, the task array, or any task field
 *   is invalid, ids are duplicated, or the array exceeds maxPlanTasks.
 * @emits factory/contract-registered
 */
registerPlanContract(planId: string, tasks: FactoryPlanTask[]): void

/**
 * Read the atomic-task contract for a plan id, as a fresh copy.
 *
 * @param planId - The plan id.
 * @returns The registered tasks (a fresh array), or undefined when the
 *   plan id is not registered.
 */
getPlanContract(planId: string): FactoryPlanTask[] | undefined

/**
 * List all registered plan ids, in registration order.
 *
 * @returns The registered plan ids.
 */
listPlanIds(): string[]

/**
 * Deterministic BAR judge for a single task submission.
 *
 * PASS requires a non-empty normalized summary, a non-empty array of
 * non-empty normalized evidence strings, and a non-empty array of
 * non-empty normalized file paths. Any failed clause is reported with an
 * exact reason string.
 *
 * @param planId - The plan id the submission targets.
 * @param submission - The submitted work for one atomic task.
 * @returns The BAR verdict for the submission.
 * @throws {Error} When the plan id is unknown or the task id is not in the
 *   plan contract.
 */
scoreTask(planId: string, submission: BarSubmission): BarVerdict

/**
 * Aggregate BAR score over a whole plan contract.
 *
 * Each contract task is scored against the FIRST submission with a
 * matching task id; tasks without a submission count as NOT_SUBMITTED.
 *
 * @param planId - The plan id to score.
 * @param submissions - The submissions for the plan's tasks.
 * @returns The aggregate contract score.
 * @throws {Error} When the plan id is unknown.
 */
scoreContract(planId: string, submissions: BarSubmission[]): ContractScore

/**
 * Build the immutable planner objective for the ralph tool.
 * @param role - the planner role selector.
 * @param input - the planner input.
 * @returns the immutable planner objective string.
 */
buildRoleObjective(role: 'planner', input: PlannerInput): string

/**
 * Build the immutable developer objective for one atomic task.
 * @param role - the developer role selector.
 * @param task - the atomic task to build the objective for.
 * @param options - optional workspace override.
 * @returns the immutable developer objective string.
 */
buildRoleObjective(role: 'developer', task: FactoryPlanTask, options?: { workspace?: string }): string

/**
 * Build the immutable critic objective reviewing work against one atomic task.
 * @param role - the critic role selector.
 * @param task - the atomic task the work claims to complete.
 * @param work - the critic input: summary and changed files.
 * @returns the immutable critic objective string.
 */
buildRoleObjective(role: 'critic', task: FactoryPlanTask, work: { summary: string; files: string[] }): string
```

Source: [`packages/factory/factory/src/service.ts:27`](../../packages/factory/factory/src/service.ts)

<a id="ctxfactoryjudge--judgeservice"></a>

### `ctx.factoryJudge` — `JudgeService`

The Pass 4 judge seam: unanimous three-panel verdicts with a bounded replan loop, votes in the event stream, and replan cost charged to accounting.

Fresh-context guarantee: ballots are computed independently from the request + the role charter only; the service shares NO ballot state between roles. Golden rule: the judge never touches session log, message history, or projections — it operates on plan artifacts only.

```ts cordis-catalog
/**
 * Judge one request: compute the ballots (single → decomposition only;
 * panel → decomposition + feasibility + verification), emit each ballot,
 * and settle the verdict — PASS when every ballot is YES; REPLAN when any
 * NO and replan budget remains (charge replanCost to accounting, emit
 * judge/replan); ESCALATE when any NO and the budget is exhausted (no new
 * charge). A plan PASS records the approval; PASS and ESCALATE clear the
 * judgment's replan entry. Emits judge/verdict last.
 *
 * @param request - the judgment request; mode defaults 'panel' and account
 *   defaults 'default'.
 * @returns the settled verdict with every ballot and the replan budget.
 * @throws {Error} When the service is disabled.
 * @throws {TypeError} When the request is malformed: a non-empty normalized
 *   judgmentId/planId/revision is required, kind must be valid, 'plan'
 *   requests require a non-empty tasks array, 'completion' requests require
 *   a submission, and 'triage' requests require a triage.
 * @emits judge/ballot, judge/replan, judge/verdict
 */
judge(request: JudgeRequest): JudgeVerdict

/**
 * Whether a plan revision was approved by a panel PASS.
 *
 * @param planId - the plan id.
 * @param revision - when given, the approval must match this revision
 *   exactly; when omitted, any recorded approval counts.
 * @returns true when the plan (revision) was approved.
 */
isPlanApproved(planId: string, revision?: string): boolean

/**
 * Read the replan budget for one judgment.
 *
 * @param judgmentId - the judgment id.
 * @returns the replans used and the configured maximum (0 for an unknown
 *   judgment id).
 */
replanState(judgmentId: string): JudgeReplanState

/**
 * Reset a judgment's replan budget. Approvals persist.
 *
 * @param judgmentId - the judgment id to clear.
 */
resetJudgment(judgmentId: string): void
```

Source: [`packages/factory/factory-judge/src/service.ts:53`](../../packages/factory/factory-judge/src/service.ts)

<a id="ctxguardtoolallowlist--toolallowlistservice"></a>

### `ctx.guardToolAllowlist` — `ToolAllowlistService`

The gate Service. Constructing it registers the `tools/execute` wrapper; mounting the plugin is what arms the gate. The allowlist is a plain set for O(1) membership; the auditable event rides the declared `guard/allowlist-deny` event.

Source: [`packages/guard/tool-allowlist/src/index.ts:71`](../../packages/guard/tool-allowlist/src/index.ts)

<a id="ctxjudgegate--judgegateservice"></a>

### `ctx.judgeGate` — `JudgeGateService`

The Pass 4 judge gate: enforces the three-panel panel at the three SAD moments. Resolves the panel via ctx.get('factoryJudge') at INVOCATION time (never at load), so compositions without the factory packages still boot; invoking the gate without the panel fails closed with a clear error.

```ts cordis-catalog
/**
 * Gate the plan admission moment: parse the presented plan, run the panel
 * (kind 'plan'), and fail closed unless every ballot is YES. A PASS records
 * the approval (panel-side) and admits the plan for completion/exit votes.
 *
 * @param input - the presented plan: plan id, revision (presentation
 *   ordinal — a re-present after a NO bumps it), and the plan markdown.
 * @returns the settled PASS verdict.
 * @throws {JudgeGateError} When the plan does not pass (REPLAN/ESCALATE),
 *   when it has no parseable task rows, or when the panel is missing.
 * @throws {Error} When the gate is disabled.
 */
admitPlan(input: JudgeGateAdmissionInput): JudgeVerdict

/**
 * Gate the task completion moment: run the panel with kind 'completion'
 * against the ADMITTED plan's tasks. Fail closed when the plan was never
 * admitted or the claim is not evidence-backed.
 *
 * @param input - the admitted plan id + revision and the claimed submission.
 * @returns the settled PASS verdict.
 * @throws {JudgeGateError} On NOT PASS, on an unknown or mismatched
 *   admission, or when the panel is missing.
 * @throws {Error} When the gate is disabled.
 */
checkCompletion(input: JudgeGateCompletionInput): JudgeVerdict

/**
 * Gate the exit review moment: the final completion verdict over the
 * admitted plan. Same verification contract as checkCompletion.
 *
 * @param input - the admitted plan id + revision and the claimed submission.
 * @returns the settled PASS verdict.
 * @throws {JudgeGateError} On NOT PASS, on an unknown or mismatched
 *   admission, or when the panel is missing.
 * @throws {Error} When the gate is disabled.
 */
reviewExit(input: JudgeGateCompletionInput): JudgeVerdict
```

Source: [`packages/guard/judge-gate/src/service.ts:68`](../../packages/guard/judge-gate/src/service.ts)

<a id="ctxkgraph--kgraph-abstract-seam"></a>

### `ctx.kgraph` — `KGraph` (abstract seam)

Abstract OKR knowledge-graph service. Subclass, implement the six operations, and load the subclass as a plugin — it registers as `ctx.kgraph` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior).

Semantics every implementation must honor:

- upsertObjective creates a new objective when `id` is omitted and updates the matching row (name, description, status) when it is present.
- listObjectives returns all objectives with their key results attached.
- addKeyResult appends one key result to an existing objective.
- addEvidence persists one evidence row pointing at a session-log event; rows are unique per `(sessionId, seq)` so replays never duplicate.
- buildGraphFromSession derives objectives and evidence from one session log deterministically (no LLM judgment) and is idempotent per `(sessionId, seq)`.
- getStats reports aggregate row counts and the number of sessions ingested.

```ts cordis-catalog
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
```

Source: [`packages/kgraph/kgraph/src/service.ts:50`](../../packages/kgraph/kgraph/src/service.ts)

<a id="ctxlaneguard--laneguardservice"></a>

### `ctx.laneGuard` — `LaneGuardService`

The Fix 12/6 lane-separation seam: channel-based instruction marking, the tool-call allowlist gate at the harness boundary, the PromptArmor-pattern sanitization pass, and taint-aware verification for the in-band class.

State is config only — the gate is a pure function of the tool name and the passes are pure — which is what makes the service golden-rule safe.

```ts cordis-catalog
/**
 * The tool-call allowlist gate: evaluate the execution against the policy
 * and return the denial reason, or undefined when allowed. Emits
 * 'lane/veto' on denial. This is the exact function handed to
 * `ctx.tools.guard`.
 *
 * @param execution - the tool execution: name plus optional parsed arguments.
 * @returns the allowlist denial reason, or undefined when the call is
 *   allowed (or the service is disabled — passive, and the gate is not
 *   registered either).
 */
guardReason(execution: { name: string; arguments?: unknown }): string | undefined

/**
 * Evaluate one tool call against the allowlist policy.
 *
 * @param exec - the tool execution: name plus optional parsed arguments.
 * @returns the allow decision (allowed, matched pattern, denial reason).
 * @throws when the service is disabled ('lane-guard disabled').
 */
evaluateGate(exec: { name: string; arguments?: unknown }): AllowDecision

/**
 * Derive channel markings for a message list without mutating it.
 *
 * @param messages - the message list (role + content per entry).
 * @returns a NEW array of channeled messages; the input array and every
 *   input object are never mutated (golden rule).
 * @throws when the service is disabled ('lane-guard disabled').
 */
markChannels(messages: ReadonlyArray<{ role: string; content: string }>): ChanneledMessage[]

/**
 * Strip injected prompts from text (PromptArmor-pattern deterministic pass).
 * Passive when disabled or when the sanitize pass is off — this pass is
 * defense-in-depth, not a gate.
 *
 * @param text - the raw untrusted text (typically tool output).
 * @returns the sanitized text, strip hits, and total chars removed.
 */
sanitize(text: string): SanitizeResult

/**
 * Taint-aware verification of a composed output against extracted triples.
 *
 * @param output - the composed output text.
 * @param triples - the fact triples extracted from CONTENT.
 * @returns the verdict: verified, traced count, and untraced clauses.
 * @throws when the service is disabled ('lane-guard disabled').
 */
verifyComposed(output: string, triples: FactTriple[]): TaintVerdict

/**
 * The fixture seam: one deterministic call, zero LLM, that defends a
 * single payload — sanitize first (resisted when any strip fired), then
 * the allowlist gate (resisted when the directed tool is not allowed),
 * else not resisted.
 *
 * @param payload - the injection payload (id, class, content, directedTool).
 * @returns the defense result: resisted, via ('sanitize' | 'allowlist' |
 *   'none'), and detail (strip hit markers or the allowlist reason).
 * @throws when the service is disabled ('lane-guard disabled').
 */
defend(payload: InjectionPayload): DefenseResult
```

Source: [`packages/factory/factory-lane-guard/src/service.ts:56`](../../packages/factory/factory-lane-guard/src/service.ts)

<a id="ctxllmcache--llmcache"></a>

### `ctx.llmCache` — `LlmCache`

Deterministic + semantic LLM response cache. Load as a plugin (`ctx.plugin(LlmCache, config)`); it registers as `ctx.llmCache` (one cache per context — loading a second throws, cordis' standard duplicate-service behavior) and, when enabled, listens on the `llm/stream` waterfall. The SQLite backend closes when the owning fiber unloads.

```ts cordis-catalog
/**
 * Snapshot of the table-level counters: rows, total hits served, rows never served
 * from cache, and `hits / (hits + misses)` (`0` when nothing has been served).
 * @returns the cache table counters.
 */
getStats(): CacheStats
```

Source: [`packages/cache/cache/src/service.ts:200`](../../packages/cache/cache/src/service.ts)

<a id="ctxllmrouter--llmrouter"></a>

### `ctx.llmRouter` — `LlmRouter`

Capability-gated LLM router. Load as a plugin (`ctx.plugin(LlmRouter, config)`); it registers as `ctx.llmRouter` (one router per context — loading a second throws, cordis' standard duplicate-service behavior) and, when enabled, listens on the `llm/stream` waterfall.

```ts cordis-catalog
/**
 * Return the configured route for a capability, if any.
 * @param capability - capability name (`'general'`, `'reasoning'`, ...).
 * @returns the configured route, or `undefined` when unconfigured.
 */
routeFor(capability: string): RouterRoute | undefined

/**
 * Read the most recent logged calls, newest first.
 * @param limit - maximum records to return (default 50).
 * @returns hydrated call records.
 */
listCalls(limit: number = 50): RouterCallRecord[]

/**
 * Total number of logged calls.
 * @returns the call-log row count.
 */
countCalls(): number
```

Source: [`packages/router/router/src/service.ts:137`](../../packages/router/router/src/service.ts)

<a id="ctxmemorystore--memorystore-abstract-seam"></a>

### `ctx.memoryStore` — `MemoryStore` (abstract seam)

Abstract semantic memory service. Subclass, implement recall, retain, and reflect, and load the subclass as a plugin — it registers as `ctx.memoryStore` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior).

Semantics every implementation must honor:

- retain persists a record's FULL `content` verbatim and returns the stored record (id and timestamp assigned by the backend).
- get returns the single record in a namespace whose content matches `key` exactly (byte-identical), not a top-k ranked subset — the exact-recovery path.
- recall ranks stored content against the query and returns the best matches with a 0..1 relevance `score`, ordered best-first, honoring `namespace` and `limit`.
- reflect reports totals, per-namespace counts, and the most recent records.

```ts cordis-catalog
/**
 * Rank stored memories against `query` and return the best matches.
 * @param query - the model-facing search text; matched by token overlap (or embeddings, when the backend has them).
 * @param opts - optional namespace scope and result limit.
 * @returns matches ordered by relevance (0..1 score), best first, capped at the smaller of
 *   `opts.limit` (default 10) and {@link RECALL_LIMIT_MAX}. Returns a ranked top-limit subset
 *   that may be incomplete; use {@link list} or {@link reflect} for the full store.
 */
abstract recall(query: string, opts?: MemoryQueryOptions): Promise<MemoryRecallResult[]>

/**
 * Persist one memory record verbatim.
 * @param record - content to store, plus optional namespace and metadata.
 * @returns the stored record including the backend-assigned id and timestamp; rejects on a storage failure.
 */
abstract retain(record: MemoryRetainInput): Promise<MemoryRecord>

/**
 * Fetch the record whose content equals `key` byte-exactly within `opts.namespace`
 * (or the default namespace when omitted). Unlike {@link recall}, this is the exact path:
 * it returns the retained content verbatim, or `undefined` when no record matches exactly.
 * @param key - the exact content string to match, byte for byte.
 * @param opts - optional namespace scope.
 * @returns the single exact match, or `undefined` when none exists.
 */
abstract get(key: string, opts?: MemoryGetOptions): Promise<MemoryRecord | undefined>

/**
 * List ALL records from the store verbatim — the exhaustive counterpart to
 * {@link recall}'s ranked top-limit subset. Returns every stored record within
 * `opts.namespace` (or the whole store when omitted), newest first, with NO result
 * cap. Unlike {@link recall}, this is not a relevance-ranked sample: it gives the
 * complete, byte-exact contents of the store so an agent can recover every fact it
 * retained (the exact-recovery path).
 * @param opts - optional namespace scope.
 * @returns all matching records, newest first, no limit applied.
 */
abstract list(opts?: MemoryListOptions): Promise<MemoryRecord[]>

/**
 * Summarize the store: total records, per-namespace counts, and the most recent records.
 * @param opts - optional namespace scope and recent-count limit.
 * @returns the store summary.
 */
abstract reflect(opts?: MemoryReflectOptions): Promise<MemorySummary>
```

Source: [`packages/memory/memory/src/service.ts:58`](../../packages/memory/memory/src/service.ts)

<a id="ctxobservability--observabilityservice"></a>

### `ctx.observability` — `ObservabilityService`

The Fix 3/6/7 observability seam: an in-memory append-only ring buffer of structured events, predictive failure signals over the stream, the deterministic completion verifier (TNR gate), and the replay-with-patch debugging substrate. The buffer is a derived projection — the session log and message history are never touched (golden rule). The verifier methods are pure filters and stay available even when the service is disabled.

```ts cordis-catalog
/**
 * Append one structured event to the ring buffer (a derived projection —
 * the event object is copied, never retained by reference). When the
 * buffer exceeds `windowSize`, the oldest event is dropped. Emits
 * `observability/report` with the current report ONLY when the signal ids
 * changed since the last emission.
 *
 * @param event - the structured event to append.
 * @throws {Error} When the service is disabled.
 * @emits observability/report
 */
record(event: ObsEvent): void

/**
 * The current signal report over the buffered events.
 *
 * @returns the composed report: metrics, firing signals, and the verdict.
 * @throws {Error} When the service is disabled.
 */
report(): SignalReport

/**
 * Replay the buffered stream with one event patched, attributing signal
 * changes to the patch — the debugging substrate: the error's surfacing
 * step is not necessarily the cause step.
 *
 * @param index - the event index in the buffered stream to replace.
 * @param event - the replacement event (the "patch").
 * @returns the before/after reports and the signal ids that changed.
 * @throws {Error} When the service is disabled.
 * @throws {RangeError} When `index` is out of bounds.
 */
signalAt(index: number, event: ObsEvent): ReplayResult

/**
 * Verify a completion claim against the checks. Completion is owned by
 * the verifier — a self-declared completion without evidence is rejected.
 * Works when disabled (the verifier is a pure filter, always available).
 *
 * @param claim - the completion claim (summary, evidence, selfDeclared).
 * @param checks - the checks the evidence must satisfy.
 * @returns the verdict: PASS with empty reasons, or FAIL with every
 *   unsatisfied check cited.
 */
verifyCompletion(claim: CompletionClaim, checks: CompletionCheck[]): CompletionVerdict

/**
 * Validate the verifier against fixtures, reporting TPR/TNR — the TNR
 * gate: a verifier that accepts negative fixtures certifies garbage.
 * Works when disabled.
 *
 * @param fixtures - the positive and negative fixtures with expected
 *   verdicts.
 * @returns the verifier stats (tpr, tnr, positives, negatives).
 */
validateVerifier(fixtures: VerifierFixture[]): VerifierStats

/**
 * A read-only view of the ring buffer. Callers must not mutate the
 * returned array — the golden-rule tests assert the buffer never changes
 * externally.
 *
 * @returns the buffered events.
 */
stream(): readonly ObsEvent[]

/**
 * Clear the ring buffer and the last-emitted signal ids.
 *
 * @throws {Error} When the service is disabled.
 */
reset(): void
```

Source: [`packages/factory/factory-observability/src/service.ts:64`](../../packages/factory/factory-observability/src/service.ts)

<a id="ctxpromptcontexttrim--promptcontexttrimservice"></a>

### `ctx.promptContextTrim` — `PromptContextTrimService`

Register `ctx.promptContextTrim` to trim the conversation surface verbatim after the cached core is fixed.

```ts cordis-catalog
/**
 * Trim the surface verbatim, honoring the configured budget and floor.
 *
 * When `enabled` is off, or the surface is already within the threshold, the
 * surface is returned unchanged. Never mutates the input.
 *
 * @param surface - the rolling conversation surface, oldest first.
 * @param overrides - per-call budget/floor/measure overrides.
 * @returns the trim outcome.
 */
trim( surface: readonly SurfaceLine[], overrides: Partial<TrimOptions> = {}, ): TrimResult
```

Source: [`packages/prompt/prompt-context-trim/src/index.ts:47`](../../packages/prompt/prompt-context-trim/src/index.ts)

<a id="ctxpromptcorpus--promptcorpusservice"></a>

### `ctx.promptCorpus` — `PromptCorpusService`

Register `ctx.promptCorpus` — the L2 RAG index over instruction corpora served on the MemoryStore seam.

Consumers receive the memory store via the declared `memoryStore` injection (load ordering + typed `ctx.memoryStore` access); the constructor runs synchronously, so `ctx.promptCorpus` is available as soon as this service's load settles.

```ts cordis-catalog
/**
 * Chunk a corpus document at semantic boundaries and retain each typed chunk
 * into the memory store under the `prompt:<corpus>` namespace.
 *
 * Every record carries structured metadata: `kind: 'prompt-corpus-chunk'`,
 * `corpus`, `scope`, `specificityRank`, `cacheStable`, plus the chunk's
 * `index`, `heading`, and `depth`. This is the metadata later stages (recall
 * routing, cross-encoder re-rank, budget allocation) act on, so the model /
 * assembler never re-parses the corpus.
 *
 * @param document - the corpus text to index.
 * @param options - corpus/scope labels plus an optional namespace override.
 * @returns counts + labels of the retained chunks.
 */
async ingest(document: string, options: IngestOptions = {}): Promise<IngestResult>

/**
 * Report the prompt-corpus index size: total retained chunks and the count
 * per corpus.
 *
 * @param opts - optional namespace scope to limit the summary.
 * @returns total chunk count and per-corpus breakdown.
 */
async reflect(opts?: MemoryReflectOptions): Promise<PromptCorpusSummary>

/**
 * Rank the prompt-corpus index against a query and return the best chunks.
 *
 * The router delegates to the underlying MemoryStore hybrid recall (lexical
 * overlap by default; embeddings when the backend is configured with one), so
 * it works with zero embedding config out of the box. When a single corpus is
 * named, recall runs scoped to that corpus' `prompt:<corpus>` namespace; when
 * no corpus is named it spans all prompt corpora. Results keep their 0..1
 * backend score and the corpus label each chunk was ingested under, so an
 * assembler can order by germane corpus (skills for tool turns, workspace
 * instructions for that dir) without re-parsing the store.
 *
 * @param query - the working-intent text to match chunks against.
 * @param options - result limit and optional single-corpus scope.
 * @returns ranked chunks, best first, capped at `limit` (default 10).
 */
async recall(query: string, options: PromptRecallOptions = {}): Promise<PromptRecallResult[]>
```

Source: [`packages/prompt/prompt-corpus/src/index.ts:100`](../../packages/prompt/prompt-corpus/src/index.ts)

<a id="ctxpromptlume--promptlumeservice"></a>

### `ctx.promptLume` — `PromptLumeService`

Register `ctx.promptLume`: a `system-prompt/assemble` listener stages the relevance-gated, provenance-labeled task-aligned region for that turn, and a pre-step flushes it as a self-superseding tail user/message via emitRegion. The region is never committed to the byte-stable core section list, so the provider KV prefix cache read stays alive across turns.

The constructor registers the assemble listener, so once this service's load settles every subsequent assembly is relevance-gated (when the caller has primed a turn surface). With no primed turn or an empty intent the listener passes the assembly through unchanged — core only, and no region is staged for emission.

```ts cordis-catalog
/**
 * Record the current turn surface before the next assembly.
 *
 * The assemble event carries no turn text, so the caller (the agent loop)
 * primes the distilled working intent here; the listener consumes and clears
 * it on the next assembly. An unprimed or empty intent yields core-only.
 *
 * @param turn - the distilled intent and optional corpus-affinity kind.
 */
primeTurn(turn: TurnSurface): void

/**
 * Cumulative cost-sidecar totals across every recorded assembly.
 *
 * Feeds the corrections-per-session benchmark without requiring a listener
 * to have captured the per-call `prompt-lume/cost` events.
 * @returns the aggregated cost summary (calls, cache hits/misses, token and
 * region totals) as a detached immutable record.
 */
costSummary(): ReturnType<CostSidecar['summary']>

/**
 * Emit the pending task-aligned region as a self-superseding user message
 * appended AFTER the retained conversation history.
 *
 * The message supersedes the previous region message (when one was emitted)
 * via `surfaceOp: { op: 'replace', start, end }` spanning exactly the prior
 * region node, so exactly one region wall is ever on the surface and the
 * byte-stable core prefix ahead of history stays provider-cache-stable. The
 * first emission appends normally (no prior node to replace).
 *
 * @param session - the live agent session to append the region onto.
 * @returns the emitted user message, or undefined when no region is pending.
 */
emitRegion(session: Session): SessionEvent<'user/message'> | undefined

/**
 * True when the current turn's assembled region is still pending emission.
 * Lets the driving pre-step decide whether an emission is merited.
 *
 * @returns whether a region is staged (non-empty) and awaits emission.
 */
hasPendingRegion(): boolean
```

Types: [Session](session.md) · [SessionEvent](session.md)

Source: [`packages/prompt/prompt-lume/src/index.ts:154`](../../packages/prompt/prompt-lume/src/index.ts)

<a id="ctxresearch--researchservice"></a>

### `ctx.research` — `ResearchService`

External research service. Load as a plugin (`ctx.plugin(ResearchService, config)`); it registers as `ctx.research` (one per context — loading a second throws, cordis' standard duplicate-service behavior). The service is stateless apart from the in-memory counters returned by `getStats()`, so it owns no resources to dispose.

```ts cordis-catalog
/**
 * Search social posts through the `xurl` CLI.
 * @param query - the search query.
 * @param options - optional result cap; defaults to the config `maxResults`.
 * @returns the mapped posts; `[]` when disabled, the xurl binary is missing
 * (ENOENT), or the lookup fails (failures are counted in `getStats()`).
 */
async searchPosts(query: string, options: { limit?: number } = {}): Promise<ResearchPost[]>

/**
 * Search arXiv papers through the Atom API.
 * @param query - the search query (sent as `all:<query>`).
 * @param options - optional result cap; defaults to the config `maxResults`.
 * @returns the parsed papers; `[]` when disabled or the lookup fails
 * (failures are counted in `getStats()`).
 */
async searchPapers(query: string, options: { maxResults?: number } = {}): Promise<ResearchPaper[]>

/**
 * Fetch one arXiv paper by id through the Atom API.
 * @param id - the arXiv id (with or without the `https://arxiv.org/abs/` prefix).
 * @returns the parsed paper, or `null` when disabled, not found, or the lookup fails.
 */
async fetchPaper(id: string): Promise<ResearchPaper | null>

/**
 * Snapshot of the per-source counters.
 * @returns the current research stats.
 */
getStats(): ResearchStats
```

Source: [`packages/research/research/src/service.ts:193`](../../packages/research/research/src/service.ts)

<a id="ctxroutertrainer--routertrainer"></a>

### `ctx.routerTrainer` — `RouterTrainer`

Collects one `router/call-logged` record per routed call as a training sample, in arrival order, plus `CorrectionRecord` rewards threaded onto corrected samples. A downstream trainer drains records (or the optional JSONL output sink) at its own cadence; reset starts a fresh queue.

```ts cordis-catalog
/**
 * Number of samples collected since the last {@link reset}.
 * @returns the sample count.
 */
count(): number

/**
 * Samples collected so far, in arrival order.
 * @returns the collected training samples.
 */
records(): readonly TrainingSample[]

/** Drop all collected samples (does not truncate an `outputPath` file). */
reset(): void

/**
 * Corrections threaded into the trainer as rewards so far, in arrival order.
 * @returns the consumed correction records.
 */
corrections(): readonly CorrectionRecord[]

/**
 * Samples whose call received a threaded correction reward, in arrival order. A
 * sample's {@link CorrectionRecord reward} is set only after a correction referenced
 * its call id, so this proves which corrections were consumed as rewards.
 * @returns the rewarded training samples.
 */
rewards(): readonly TrainingSample[]

/**
 * Thread one correction into the trainer's sample log as a reward signal: append it to
 * the optional JSONL sink (the same `outputPath` log as the samples) and, when it
 * references a recorded call, attach it to that sample as its reward. A correction
 * referencing a call the trainer has not seen is still recorded, so no correction is
 * lost.
 * @param correction - the correction to consume as a reward.
 */
recordCorrection(correction: CorrectionRecord): void

/**
 * Append one routed call record to the sample queue and the optional JSONL sink.
 * @param record - the routed call record to append.
 */
onCall(record: TrainingSample): void
```

Source: [`packages/router/trainer/src/trainer.ts:48`](../../packages/router/trainer/src/trainer.ts)

<a id="accounting-events"></a>

### `accounting/*` events

<a id="accountingdebit--emit"></a>

#### `accounting/debit` — emit

A debit ledger row was written for a completed `llm/stream` call. Fires once per stream that reported usage, after the stream finished.

```ts cordis-catalog
/**
 * A debit ledger row was written for a completed `llm/stream` call. Fires
 * once per stream that reported usage, after the stream finished.
 * @param record - the debit row: account, token amount, reason, and balance after.
 * @mode emit
 */
'accounting/debit'(record: AccountingDebitRecord): void
```

Source: [`packages/accounting/accounting/src/types.ts:16`](../../packages/accounting/accounting/src/types.ts)

<a id="accountinggrant--emit"></a>

#### `accounting/grant` — emit

A credit grant ledger row was written (initial credits or an explicit `grant()` call). Fires after the row is committed.

```ts cordis-catalog
/**
 * A credit grant ledger row was written (initial credits or an explicit
 * `grant()` call). Fires after the row is committed.
 * @param record - the grant row: account, token amount, reason, and balance after.
 * @mode emit
 */
'accounting/grant'(record: AccountingGrantRecord): void
```

Source: [`packages/accounting/accounting/src/types.ts:23`](../../packages/accounting/accounting/src/types.ts)

<a id="bench-events"></a>

### `bench/*` events

<a id="benchcontract-checklist--emit"></a>

#### `bench/contract-checklist` — emit

Diagnostic emitted when the contract pre-flight reads the contract source on the first edit. Carries the extracted clause count and the rendered checklist. Never model-visible.

```ts cordis-catalog
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
'bench/contract-checklist'(event: { clauseCount: number source: string checklist: string ts: number }): void
```

Source: [`packages/bench/bench/src/run/pre-execute.ts:198`](../../packages/bench/bench/src/run/pre-execute.ts)

<a id="benchcontract-coverage--emit"></a>

#### `bench/contract-coverage` — emit

Diagnostic emitted when the session is closing: name the clauses the visible tests do NOT cover (the §4.2 gap the verifier still enforces).

```ts cordis-catalog
/**
 * Diagnostic emitted when the session is closing: name the clauses the
 * visible tests do NOT cover (the §4.2 gap the verifier still enforces).
 * @param event - the contract-coverage payload.
 * @param event.uncoveredCount - clauses with no visible test.
 * @param event.report - the rendered coverage-diff block.
 * @param event.ts - emission timestamp (epoch ms).
 * @mode emit
 */
'bench/contract-coverage'(event: { uncoveredCount: number report: string ts: number }): void
```

Source: [`packages/bench/bench/src/run/pre-execute.ts:213`](../../packages/bench/bench/src/run/pre-execute.ts)

<a id="benchfailure-memory-pin--emit"></a>

#### `bench/failure-memory-pin` — emit

Diagnostic emitted when the failure-signature memory records a new failure signature or vetoes a repeat of a recorded same-signature call. Carries the tool, the failure, and the record count. Never model-visible.

```ts cordis-catalog
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
'bench/failure-memory-pin'(event: { tool: string failure?: string records: number ts: number directive?: string }): void
```

Source: [`packages/bench/bench/src/run/failure-memory.ts:89`](../../packages/bench/bench/src/run/failure-memory.ts)

<a id="benchguard-veto--emit"></a>

#### `bench/guard-veto` — emit

Diagnostic emitted when a guard stops the session. Carries the reason, observed call count, ceiling, and the summarize & submit directive the vetoed tool result embeds — the fallback a downstream log consumer can observe.

```ts cordis-catalog
/**
 * Diagnostic emitted when a guard stops the session. Carries the reason,
 * observed call count, ceiling, and the summarize & submit directive the
 * vetoed tool result embeds — the fallback a downstream log
 * consumer can observe.
 * @param event - the guard-veto payload.
 * @param event.reason - why the guard stopped the session.
 * @param event.count - observed call count.
 * @param event.ceiling - the per-task ceiling that was exceeded.
 * @param event.ts - emission timestamp (epoch ms).
 * @param event.directive - the summarize-and-submit fallback directive.
 * @mode emit
 */
'bench/guard-veto'( event: { reason: GuardReason count: number ceiling: number ts: number directive?: string }, ): void
```

Source: [`packages/bench/bench/src/run/guard.ts:325`](../../packages/bench/bench/src/run/guard.ts)

<a id="benchmistake-ledger-pin--emit"></a>

#### `bench/mistake-ledger-pin` — emit

Diagnostic emitted when the mistake ledger pins a record or vetoes a re-try of a ledger-listed tool. Carries the tool, the pinned record, and the pivot directive the vetoed tool result embeds. Never model-visible.

```ts cordis-catalog
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
'bench/mistake-ledger-pin'( event: { tool: string failure?: string records: number ts: number directive?: string }, ): void
```

Source: [`packages/bench/bench/src/run/mistake-ledger.ts:177`](../../packages/bench/bench/src/run/mistake-ledger.ts)

<a id="benchovernight-patch--emit"></a>

#### `bench/overnight-patch` — emit

Diagnostic emitted when the overnight-patch coordinator drafts and writes the artifact. Carries the artifact path + recurring-cluster count. Never model-visible.

```ts cordis-catalog
/**
 * Diagnostic emitted when the overnight-patch coordinator drafts and
 * writes the artifact. Carries the artifact path + recurring-cluster
 * count. Never model-visible.
 * @param event - the overnight-patch payload.
 * @param event.artifactPath - path of the drafted artifact file.
 * @param event.clusters - number of recurring correction clusters found.
 * @param event.ts - emission timestamp (epoch ms).
 * @mode emit
 */
'bench/overnight-patch'( event: { artifactPath: string clusters: number ts: number }, ): void
```

Source: [`packages/bench/bench/src/run/overnight-patch.ts:227`](../../packages/bench/bench/src/run/overnight-patch.ts)

<a id="benchretry-judge-veto--emit"></a>

#### `bench/retry-judge-veto` — emit

Diagnostic emitted when the retry judge vetoes a tool retry. Carries the tool, the observed consecutive failures, the ceiling, and the pivot directive the vetoed tool result embeds. Never model-visible.

```ts cordis-catalog
/**
 * Diagnostic emitted when the retry judge vetoes a tool retry. Carries
 * the tool, the observed consecutive failures, the ceiling, and the pivot
 * directive the vetoed tool result embeds. Never model-visible.
 * @param event - the retry-judge-veto payload.
 * @param event.tool - the tool whose retry was vetoed.
 * @param event.previousFailures - consecutive failures observed.
 * @param event.maxConsecutive - the ceiling that was exceeded.
 * @param event.ts - emission timestamp (epoch ms).
 * @param event.directive - the pivot directive the vetoed result embeds.
 * @mode emit
 */
'bench/retry-judge-veto'( event: { tool: string previousFailures: number maxConsecutive: number ts: number directive?: string }, ): void
```

Source: [`packages/bench/bench/src/run/retry-judge.ts:173`](../../packages/bench/bench/src/run/retry-judge.ts)

<a id="benchtripwire-alarm--emit"></a>

#### `bench/tripwire-alarm` — emit

Diagnostic emitted when the tripwire stops the session. Carries the predicted count, observed actual count, trip ratio, and the checkpoint-and-replan directive the vetoed tool result embeds — the fallback a downstream log consumer can observe.

```ts cordis-catalog
/**
 * Diagnostic emitted when the tripwire stops the session. Carries the
 * predicted count, observed actual count, trip ratio, and the
 * checkpoint-and-replan directive the vetoed tool result embeds — the
 * fallback a downstream log consumer can observe.
 * @param event - the tripwire-alarm payload.
 * @param event.predicted - the estimated tool-call count.
 * @param event.actual - the observed tool-call count.
 * @param event.ratio - actual/predicted ratio that tripped the wire.
 * @param event.ts - emission timestamp (epoch ms).
 * @param event.directive - the checkpoint-and-replan fallback directive.
 * @mode emit
 */
'bench/tripwire-alarm'( event: { predicted: number actual: number ratio: number ts: number directive?: string }, ): void
```

Source: [`packages/bench/bench/src/run/tripwire.ts:175`](../../packages/bench/bench/src/run/tripwire.ts)

<a id="benchverify-required--emit"></a>

#### `bench/verify-required` — emit

Diagnostic emitted when the verify-required bit is armed for a session: carries the matched patterns and the forced-purpose value. Never model-visible.

```ts cordis-catalog
/**
 * Diagnostic emitted when the verify-required bit is armed for a session:
 * carries the matched patterns and the forced-purpose value. Never
 * model-visible.
 * @param event - the verify-required payload.
 * @param event.matched - the stale-knowledge patterns that armed the bit.
 * @param event.forcedPurpose - the verification purpose forced for the session.
 * @param event.ts - emission timestamp (epoch ms).
 * @mode emit
 */
'bench/verify-required'( event: { matched: string[] forcedPurpose: string ts: number }, ): void
```

Source: [`packages/bench/bench/src/run/verify.ts:129`](../../packages/bench/bench/src/run/verify.ts)

<a id="budget-events"></a>

### `budget/*` events

<a id="budgetroute--emit"></a>

#### `budget/route` — emit

An `llm/stream` call settled with its cost-conditioned route decision.

```ts cordis-catalog
/**
 * An `llm/stream` call settled with its cost-conditioned route decision.
 *
 * @mode emit
 * @param record - the decision: account, stage, cumulative cost, requested
 *   and resolved provider/model, and the route state.
 */
'budget/route'(record: BudgetRouteDecision): void
```

Source: [`packages/factory/factory-budget-router/src/index.ts:33`](../../packages/factory/factory-budget-router/src/index.ts)

<a id="budgetveto--emit"></a>

#### `budget/veto` — emit

A hard budget veto stopped an `llm/stream` call: the account's spend reached its configured budget, so the call is rejected with `BUDGET_EXCEEDED` before any adapter runs.

```ts cordis-catalog
/**
 * A hard budget veto stopped an `llm/stream` call: the account's spend
 * reached its configured budget, so the call is rejected with
 * `BUDGET_EXCEEDED` before any adapter runs.
 *
 * @mode emit
 * @param record - the veto: account, spend, budget, stage, and timestamp.
 */
'budget/veto'(record: BudgetVetoRecord): void
```

Source: [`packages/factory/factory-budget-router/src/index.ts:25`](../../packages/factory/factory-budget-router/src/index.ts)

<a id="cache-events"></a>

### `cache/*` events

<a id="cachehit--emit"></a>

#### `cache/hit` — emit

A cached completion was served from the `llm_cache` table without an upstream call. Fires once per hit, carrying the stored key and the tier that matched.

```ts cordis-catalog
/**
 * A cached completion was served from the `llm_cache` table without an upstream
 * call. Fires once per hit, carrying the stored key and the tier that matched.
 * @param record - the hit: stored key, timestamp, and matching tier.
 * @mode emit
 */
'cache/hit'(record: CacheHitRecord): void
```

Source: [`packages/cache/cache/src/types.ts:16`](../../packages/cache/cache/src/types.ts)

<a id="cachemiss--emit"></a>

#### `cache/miss` — emit

A call missed the cache and was forwarded upstream; the completion will be stored on success. Fires once per miss, before the stream is consumed.

```ts cordis-catalog
/**
 * A call missed the cache and was forwarded upstream; the completion will be
 * stored on success. Fires once per miss, before the stream is consumed.
 * @param record - the miss: request key and timestamp.
 * @mode emit
 */
'cache/miss'(record: CacheMissRecord): void
```

Source: [`packages/cache/cache/src/types.ts:23`](../../packages/cache/cache/src/types.ts)

<a id="context-debt-events"></a>

### `context-debt/*` events

<a id="context-debtplan--emit"></a>

#### `context-debt/plan` — emit

A fold-only compaction plan was produced for a session.

```ts cordis-catalog
/**
 * A fold-only compaction plan was produced for a session.
 * @mode emit
 * @param plan - the produced plan; foldOnly is always `true`.
 */
'context-debt/plan'(plan: CompactionPlan): void
```

Source: [`packages/session/session-context-debt/src/index.ts:34`](../../packages/session/session-context-debt/src/index.ts)

<a id="context-debtscan--emit"></a>

#### `context-debt/scan` — emit

A context-debt scan completed over a session's committed events.

```ts cordis-catalog
/**
 * A context-debt scan completed over a session's committed events.
 * @mode emit
 * @param scan - the scan result (reports + foldSeq).
 */
'context-debt/scan'(scan: ContextDebtScan): void
```

Source: [`packages/session/session-context-debt/src/index.ts:28`](../../packages/session/session-context-debt/src/index.ts)

<a id="coordination-events"></a>

### `coordination/*` events

<a id="coordinationworker-completed--emit"></a>

#### `coordination/worker-completed` — emit

A subagent worker settled and its `coord_workers` row was updated to `'completed'` or `'failed'` with the outcome text. Fires once per spawn, after the row lands.

```ts cordis-catalog
/**
 * A subagent worker settled and its `coord_workers` row was updated to
 * `'completed'` or `'failed'` with the outcome text. Fires once per
 * spawn, after the row lands.
 * @param payload.workerId - the settled worker's id.
 * @param payload.provider - the provider key that spawned it.
 * @param payload.status - `'completed'` or `'failed'`.
 * @mode emit
 */
'coordination/worker-completed'(payload: { workerId: string provider: string status: WorkerStatus }): void
```

Source: [`packages/coordination/coordination/src/types.ts:29`](../../packages/coordination/coordination/src/types.ts)

<a id="coordinationworker-started--emit"></a>

#### `coordination/worker-started` — emit

A subagent worker was published by the subagent registry and recorded as `'running'` in the `coord_workers` table. Fires once per spawn, after the row lands.

```ts cordis-catalog
/**
 * A subagent worker was published by the subagent registry and recorded
 * as `'running'` in the `coord_workers` table. Fires once per spawn,
 * after the row lands.
 * @param payload.workerId - the spawned worker's id.
 * @param payload.provider - the provider key that spawned it.
 * @mode emit
 */
'coordination/worker-started'(payload: { workerId: string; provider: string }): void
```

Source: [`packages/coordination/coordination/src/types.ts:19`](../../packages/coordination/coordination/src/types.ts)

<a id="factory-events"></a>

### `factory/*` events

<a id="factorycontract-registered--emit"></a>

#### `factory/contract-registered` — emit

A factory plan contract was registered or replaced.

```ts cordis-catalog
/**
 * A factory plan contract was registered or replaced.
 *
 * @mode emit
 * @param payload - The contract-registration event payload.
 */
'factory/contract-registered'(payload: { planId: string; count: number }): void
```

Source: [`packages/factory/factory/src/index.ts:13`](../../packages/factory/factory/src/index.ts)

<a id="guard-events"></a>

### `guard/*` events

<a id="guardallowlist-deny--emit"></a>

#### `guard/allowlist-deny` — emit

Emitted when an out-of-list tool call is denied at the gate.

```ts cordis-catalog
/**
 * Emitted when an out-of-list tool call is denied at the gate.
 *
 * @param data - the denial payload: the rejected tool name and the calling
 *   agent (when the call has one).
 * @mode emit
 */
'guard/allowlist-deny'(data: ToolAllowlistDenyEvent): void
```

Source: [`packages/guard/tool-allowlist/src/index.ts:135`](../../packages/guard/tool-allowlist/src/index.ts)

<a id="judge-events"></a>

### `judge/*` events

<a id="judgeballot--emit"></a>

#### `judge/ballot` — emit

One judge ballot (per panel role) was cast for a judgment round.

```ts cordis-catalog
/**
 * One judge ballot (per panel role) was cast for a judgment round.
 *
 * @mode emit
 * @param vote - The role's ballot: role, vote, and exact reasons.
 */
'judge/ballot'(vote: JudgeVote): void
```

Source: [`packages/factory/factory-judge/src/index.ts:22`](../../packages/factory/factory-judge/src/index.ts)

<a id="judgereplan--emit"></a>

#### `judge/replan` — emit

A replan was granted: any NO ballot while replan budget remains.

```ts cordis-catalog
/**
 * A replan was granted: any NO ballot while replan budget remains.
 *
 * @mode emit
 * @param payload - judgment id, plan id, kind, round, and charged cost.
 */
'judge/replan'(payload: { judgmentId: string; planId: string; kind: JudgeKind; round: number; cost: number }): void
```

Source: [`packages/factory/factory-judge/src/index.ts:36`](../../packages/factory/factory-judge/src/index.ts)

<a id="judgeverdict--emit"></a>

#### `judge/verdict` — emit

A judgment round settled with an aggregate verdict.

```ts cordis-catalog
/**
 * A judgment round settled with an aggregate verdict.
 *
 * @mode emit
 * @param verdict - The settled verdict with every ballot of the round.
 */
'judge/verdict'(verdict: JudgeVerdict): void
```

Source: [`packages/factory/factory-judge/src/index.ts:29`](../../packages/factory/factory-judge/src/index.ts)

<a id="lane-events"></a>

### `lane/*` events

<a id="laneveto--emit"></a>

#### `lane/veto` — emit

A tool call was denied by the lane-guard allowlist gate.

```ts cordis-catalog
/**
 * A tool call was denied by the lane-guard allowlist gate.
 *
 * @mode emit
 * @param record - the veto: the denied tool name, the allowlist reason,
 *   and the epoch-ms timestamp.
 */
'lane/veto'(record: LaneVetoRecord): void
```

Source: [`packages/factory/factory-lane-guard/src/index.ts:24`](../../packages/factory/factory-lane-guard/src/index.ts)

<a id="observability-events"></a>

### `observability/*` events

<a id="observabilityreport--emit"></a>

#### `observability/report` — emit

Emitted when the observability signal report changes (the signal ids differ from the last emission).

```ts cordis-catalog
/**
 * Emitted when the observability signal report changes (the signal ids
 * differ from the last emission).
 * @param report - the current signal report (metrics, signals, verdict).
 * @mode emit
 */
'observability/report'(report: SignalReport): void
```

Source: [`packages/factory/factory-observability/src/index.ts:31`](../../packages/factory/factory-observability/src/index.ts)

<a id="prompt-lume-events"></a>

### `prompt-lume/*` events

<a id="prompt-lumecost--emit"></a>

#### `prompt-lume/cost` — emit

Fired after each prompt-lume assembly with a primed turn.

Carries the per-call cost record (core/region/input heuristic tokens, cache-hit vs miss, budget vs actual region bytes) and lets cost consumers feed the corrections-per-session benchmark. The cumulative totals are also readable via PromptLumeService.costSummary.

```ts cordis-catalog
/**
 * Fired after each prompt-lume assembly with a primed turn.
 *
 * Carries the per-call cost record (core/region/input heuristic tokens,
 * cache-hit vs miss, budget vs actual region bytes) and lets cost
 * consumers feed the corrections-per-session benchmark. The cumulative
 * totals are also readable via {@link PromptLumeService.costSummary}.
 * @param record - the detached immutable per-call cost record.
 * @mode emit
 */
'prompt-lume/cost'(this: Context, record: import('./cost.ts').PromptLumeCostRecord): void
```

Source: [`packages/prompt/prompt-lume/src/index.ts:54`](../../packages/prompt/prompt-lume/src/index.ts)

<a id="research-events"></a>

### `research/*` events

<a id="researchpapers-searched--emit"></a>

#### `research/papers-searched` — emit

A paper search succeeded and returned `count` papers.

```ts cordis-catalog
/**
 * A paper search succeeded and returned `count` papers.
 * @param payload.query - the query that produced the result.
 * @param payload.count - number of returned papers.
 * @mode emit
 */
'research/papers-searched'(payload: { query: string; count: number }): void
```

Source: [`packages/research/research/src/index.ts:25`](../../packages/research/research/src/index.ts)

<a id="researchposts-searched--emit"></a>

#### `research/posts-searched` — emit

A social-post search succeeded and returned `count` posts.

```ts cordis-catalog
/**
 * A social-post search succeeded and returned `count` posts.
 * @param payload.query - the query that produced the result.
 * @param payload.count - number of returned posts.
 * @mode emit
 */
'research/posts-searched'(payload: { query: string; count: number }): void
```

Source: [`packages/research/research/src/index.ts:18`](../../packages/research/research/src/index.ts)

<a id="router-events"></a>

### `router/*` events

<a id="routercall-logged--emit"></a>

#### `router/call-logged` — emit

A routed model call completed and was appended to the call log. Fires once per call, after the row lands, carrying the same record that was inserted.

```ts cordis-catalog
/**
 * A routed model call completed and was appended to the call log. Fires once per
 * call, after the row lands, carrying the same record that was inserted.
 * @param record - the persisted call-log row.
 * @mode emit
 */
'router/call-logged'(record: RouterCallRecord): void
```

Source: [`packages/router/router/src/types.ts:16`](../../packages/router/router/src/types.ts)
<!-- END GENERATED cordis-surface -->

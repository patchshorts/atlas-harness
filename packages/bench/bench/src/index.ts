/**
 * Bench family: deterministic corrections-per-session benchmark over the
 * append-only session log — classify (C1..C5), run (N sessions per arm), and
 * report (paired stats) — the bench workstream.
 * @module @atlasai/atsh-bench
 */

export { default, BenchService } from './service.ts'
export { classifySession } from './classify/classify.ts'
export { loadSession, loadEvents, extractText, parseToolArgs, canonicalJson, sha256Hex } from './classify/events.ts'
export { matchLexicon } from './classify/lexicon.ts'
export { DEFAULT_CONFIG, FROZEN_LEXICON, loadManifestLexicon, loadConfigFromManifest } from './classify/config.ts'
export { apply, name, inject } from './invariant.ts'
export type {
  CorrectionClass,
  SessionLogEvent,
  ClassifierConfig,
  CorrectionHit,
  ClassificationCounts,
  ClassificationResult,
} from './classify/types.ts'
export type { LoadedSession } from './classify/events.ts'
export {
  aggregateArm,
  benchTmpDir,
  computeSessionCost,
  DEFAULT_SESSION_TIMEOUT_MS,
  DEFAULT_TEMPERATURE,
  fingerprint,
  guardPluginPath,
  homePatchTemplatePath,
  newRunId,
  pinPluginPath,
  preExecPluginPath,
  failureMemoryPluginPath,
  runOutputRoot,
  runSession,
  runVerifier,
  tracePluginPath,
  verifyPluginPath,
  writeHomePatch,
  writeRunLog,
} from './run/run.ts'
export {
  isLumeGrade,
  LUME_GRADES,
  REDUCER_LADDER,
} from './run/reducer-ladder.ts'
export {
  apply as applyLoopGuard,
  appendTierDirective,
  Config as loopGuardConfig,
  DEFAULT_FALLBACK_DIRECTIVE,
  foldGuard6M,
  FORCE_PLAN_RECHECK_DIRECTIVE,
  guardTierDecision,
  guardVetoResult,
  GUARD_TIER_RATIOS,
  loopGuardVerdict,
  MODEL_ESCALATE_DIRECTIVE,
  name as loopGuardName,
  RE_READ_CONTRACT_DIRECTIVE,
  VETO_CODE,
} from './run/guard.ts'
export {
  appendServeTrace,
  apply as applyServeTrace,
  name as serveTraceName,
  readServeTrace,
  shortCircuitVerdict,
} from './run/trace.ts'
export {
  apply as applyVerifyRequired,
  Config as verifyRequiredConfig,
  name as verifyRequiredName,
  STALE_VERIFY_PATTERNS,
  staleVerifyVerdict,
  VERIFICATION_REQUIRED_PURPOSE,
} from './run/verify.ts'
export {
  apply as applyTripwire,
  Config as tripwireConfig,
  DEFAULT_CHECKPOINT_DIRECTIVE,
  name as tripwireName,
  tripwireCheckpointResult,
  tripwireVerdict,
} from './run/tripwire.ts'
export {
  apply as applyRetryJudge,
  Config as retryJudgeConfig,
  DEFAULT_PIVOT_DIRECTIVE,
  name as retryJudgeName,
  retryJudgePivotResult,
  retryJudgeVerdict,
} from './run/retry-judge.ts'
export {
  apply as applyMistakeLedger,
  Config as mistakeLedgerConfig,
  DEFAULT_REPEAT_DIRECTIVE,
  compactLedgerCore,
  EMPTY_MISTAKE_LEDGER,
  gradeLedgerRender,
  ledgerRecord,
  mistakeLedgerVetoResult,
  name as mistakeLedgerName,
  pinLedgerRecord,
  renderLedgerCore,
} from './run/mistake-ledger.ts'
export {
  appendPreFlightDirective,
  apply as applyPreFlight,
  buildContractChecklist,
  Config as preFlightConfig,
  DEFAULT_DIRECTIVE_TEXT,
  diffChecklistCoverage,
  extractImperativeClauses,
  name as preFlightName,
  readContractAndDiff,
  renderCoverageDiff,
} from './run/pre-execute.ts'
export type {
  Config as PreFlightConfig,
  ContractChecklist,
  ContractClause,
  CoverageDiff,
  CoveredClause,
} from './run/pre-execute.ts'
export {
  apply as applyFailureMemory,
  checkSameSignature,
  Config as failureMemoryConfig,
  DEFAULT_SAME_SIGNATURE_DIRECTIVE,
  EMPTY_FAILURE_MEMORY,
  failureMemoryVetoResult,
  failureSignature,
  name as failureMemoryName,
  recordFailure,
  targetPathOf,
} from './run/failure-memory.ts'
export {
  apply as applyOvernightPatch,
  Config as overnightPatchConfig,
  clusterCorrections,
  clusterLogs,
  correctionClusterToken,
  draftOvernightHelp,
  loadSessionDirectory,
  name as overnightPatchName,
  runOvernightPatch,
  writeOvernightPatchArtifact,
} from './run/overnight-patch.ts'
export type {
  Config as ServeTraceConfig,
  ServeRecord,
  ServeSource,
  ShortCircuitVerdict,
} from './run/trace.ts'
export type {
  Config as LoopGuardConfig,
  GuardReason,
  GuardRuntimeEvent,
  GuardTier,
  GuardTierDecision,
  GuardVerdict,
  GuardVerdictInput,
  ToolResult as GuardToolResult,
} from './run/guard.ts'
export type {
  Config as TripwireConfig,
  ToolResult as TripwireToolResult,
  TripwireReason,
  TripwireVerdict,
  TripwireVerdictInput,
} from './run/tripwire.ts'
export type {
  Config as RetryJudgeConfig,
  ToolResult as RetryJudgeToolResult,
  RetryJudgeReason,
  RetryJudgeVerdict,
  RetryJudgeVerdictInput,
} from './run/retry-judge.ts'
export type {
  Config as MistakeLedgerConfig,
  LedgerToolResult,
  MistakeLedgerCore,
  MistakeRecord,
} from './run/mistake-ledger.ts'
export type {
  Config as OvernightPatchConfig,
  CorrectionCluster,
} from './run/overnight-patch.ts'
export { mistakeLedgerPluginPath } from './run/run.ts'
export type {
  ArmRunResult,
  BenchArm,
  RunFingerprint,
  RunLogEntry,
  SessionCost,
  SessionOutcome,
  SessionRunOptions,
} from './run/run.ts'
export { parseTokenUsage, readSessionLogFile, findNewestSessionLog } from './run/export.ts'
export type { ParsedTokenUsage, TokenUsageSurface, LoadedSessionLog } from './run/export.ts'
export { main as runCli, parseCli, taskDescriptor, tasksFromManifest } from './run/cli.ts'
export { buildReport, loadCountsFile, loadCostFile, loadRunLogHeader } from './report/report.ts'
export { taskClassOf } from './report/types.ts'
export type {
  ArmAggregate,
  BenchReport,
  ClassStratum,
  CostArtifact,
  CostSidecarBlock,
  CountsArtifact,
  CountsSession,
  CriterionResult,
  CriterionStatus,
  McNemarResult,
  PairedTaskRow,
  PairedTResult,
  ReportOptions,
  SignificanceResult,
  TaskClass,
  TurnSegments,
  WilcoxonResult,
} from './report/types.ts'
export {
  chiSquarePValue,
  computeTurnAggregate,
  computeTurnWasteRatio,
  computeWasteRatio,
  erf,
  logGamma,
  meanConfidenceInterval,
  mcNemar,
  normalCdf,
  pairedTOneSided,
  regularizedGammaP,
  regularizedGammaQ,
  regularizedIncompleteBeta,
  tCdf,
  tQuantile,
  wilcoxonSignedRankOneSided,
} from './report/stats.ts'
export type { MeanCi, TurnAggregate, TurnObservation, TurnWasteResult, TurnWasteSegment, WasteRatioConfig, WasteRatioResult } from './report/stats.ts'
export { renderJson, renderMarkdown } from './report/markdown.ts'
export { main as reportCli, parseCli as parseReportCli } from './report/cli.ts'
export type { ReportCliOptions } from './report/cli.ts'
export { auditArm, buildAuditReport, renderAuditJson, renderAuditMarkdown } from './audit/audit.ts'
export { main as auditCli, parseCli as parseAuditCli } from './audit/cli.ts'
export type { AuditArmResult, AuditReport, AuditSessionRow } from './audit/types.ts'
export type { AuditCliOptions } from './audit/cli.ts'

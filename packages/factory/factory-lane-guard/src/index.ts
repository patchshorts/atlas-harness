// Fix 12/6 lane separation + injection defense (ctx.laneGuard): channel-based
// instruction marking, tool-call allowlist at the harness boundary,
// PromptArmor-pattern sanitization, taint-aware verification for the in-band
// class — never mutates the session log or message history (golden rule).

import type { LaneGuardService } from './service.ts'
import type { LaneVetoRecord } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    laneGuard: LaneGuardService
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A tool call was denied by the lane-guard allowlist gate.
     *
     * @mode emit
     * @param record - the veto: the denied tool name, the allowlist reason,
     *   and the epoch-ms timestamp.
     */
    'lane/veto'(record: LaneVetoRecord): void
  }
}

export { default, LaneGuardService } from './service.ts'

export type {
  AllowDecision,
  AllowPolicy,
  Channel,
  ChanneledMessage,
  DefenseResult,
  FactTriple,
  InjectionPayload,
  LaneGuardConfig,
  LaneVetoRecord,
  PayloadClass,
  SanitizeHit,
  SanitizeResult,
  TaintVerdict,
} from './types.ts'

export { AUTHORITY, channelOf, higherAuthority, isToolChannel, laneLabel, markChannels } from './channels.ts'

export { evaluateAllowlist, matchesAny } from './allowlist.ts'

export { INJECTION_MARKERS, SPOOF_PREFIXES, sanitize, sanitizeToolOutput } from './sanitize.ts'

export { clauseTraces, toTriples, verifyTaintedComposition } from './taint.ts'

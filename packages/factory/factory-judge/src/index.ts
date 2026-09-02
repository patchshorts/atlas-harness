// Pass 4 unanimous three-panel judge (ctx.factoryJudge): pre-commit gate for
// plans, failure triage, and completion verdicts — decomposition veto,
// bounded replan loop, votes in the event stream, replan cost in accounting.

import type { JudgeService } from './service.ts'
import type { JudgeKind, JudgeVerdict, JudgeVote } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    factoryJudge: JudgeService
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One judge ballot (per panel role) was cast for a judgment round.
     *
     * @mode emit
     * @param vote - The role's ballot: role, vote, and exact reasons.
     */
    'judge/ballot'(vote: JudgeVote): void
    /**
     * A judgment round settled with an aggregate verdict.
     *
     * @mode emit
     * @param verdict - The settled verdict with every ballot of the round.
     */
    'judge/verdict'(verdict: JudgeVerdict): void
    /**
     * A replan was granted: any NO ballot while replan budget remains.
     *
     * @mode emit
     * @param payload - judgment id, plan id, kind, round, and charged cost.
     */
    'judge/replan'(payload: { judgmentId: string; planId: string; kind: JudgeKind; round: number; cost: number }): void
  }
}

export { default, JudgeService } from './service.ts'

export type {
  JudgeApprovalRecord,
  JudgeConfig,
  JudgeKind,
  JudgePanelRole,
  JudgePlanTask,
  JudgeReplanState,
  JudgeRequest,
  JudgeSubmission,
  JudgeTriage,
  JudgeVerdict,
  JudgeVerdictKind,
  JudgeVote,
} from './types.ts'

export { decompositionVote, feasibilityVote, verifiableVote } from './rules.ts'

export { judgeRoleObjective } from './roles.ts'

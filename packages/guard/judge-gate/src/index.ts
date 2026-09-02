// Three-panel judge gate (ctx.judgeGate): enforces the Pass 4 unanimous panel
// at the three SAD moments — plan admission, task completion, exit review.
// Fail-closed: a NOT PASS verdict throws JudgeGateError with the ballot
// reasons. The gate adds no events: ballots, replans, and verdicts ride the
// existing judge/* stream emitted by ctx.factoryJudge.

import type { JudgeGateService } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    judgeGate: JudgeGateService
  }
}

export { default, JudgeGateService, JudgeGateError } from './service.ts'

export { parsePlanTasks } from './parser.ts'

export type {
  JudgeGateAdmissionInput,
  JudgeGateCompletionInput,
  JudgeGateConfig,
} from './types.ts'

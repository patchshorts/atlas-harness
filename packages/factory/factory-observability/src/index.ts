// ObservabilityService: the ctx.observability capability (Fix 3/6/7).
// Event stream with predictive failure signals, deterministic completion
// verifier (TNR gate), and replay-with-patch — never writes to the session
// log or message history (golden rule).

import ObservabilityService from './service.ts'
import { computeMetrics, SIGNAL_THRESHOLDS } from './metrics.ts'
import { replayWithPatch } from './replay.ts'
import { composeReport, evaluateSignals } from './signals.ts'
import { OBS_STAGES, stageOfKind } from './stages.ts'
import { validateVerifier, verifyCompletion } from './verifier.ts'
import type { SignalReport } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The Fix 3/6/7 observability service: the event stream with predictive
     * failure signals, the deterministic completion verifier (TNR gate),
     * and the replay-with-patch debugging substrate.
     */
    observability: ObservabilityService
  }

  interface Events {
    /**
     * Emitted when the observability signal report changes (the signal ids
     * differ from the last emission).
     * @param report - the current signal report (metrics, signals, verdict).
     * @mode emit
     */
    'observability/report'(report: SignalReport): void
  }
}

export default ObservabilityService
export { ObservabilityService }
export { OBS_STAGES, stageOfKind }
export { computeMetrics, SIGNAL_THRESHOLDS }
export { composeReport, evaluateSignals }
export { validateVerifier, verifyCompletion }
export { replayWithPatch }
export type * from './types.ts'

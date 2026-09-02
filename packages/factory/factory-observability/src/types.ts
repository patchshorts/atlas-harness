// Types for the factory-observability package: types only, no runtime code.

export type ObsStage = 'plan' | 'explore' | 'evaluate' | 'verify'

export interface ObsEvent {
  ts: number          // epoch ms
  stage: ObsStage     // the classified stage
  kind: string        // source event kind, e.g. 'judge/ballot', 'budget/route'
  detail?: string     // optional summary, e.g. tool name or account
}

export type SignalSeverity = 'warn' | 'alarm'

export interface FailureSignal {
  id: string          // 'high-p-ratio' | 'e-to-v-deficit' | 'plan-explore-plan-spiral' | 'repeated-identical-calls'
  severity: SignalSeverity
  detail: string      // human-readable, cites the metric value
}

export interface SignalMetrics {
  totalEvents: number
  pRatio: number      // plan / total classified events
  eToV: number        // verify / (evaluate + verify); 0 when denominator is 0
  pxpSpirals: number  // count of plan→explore→plan trigrams
  maxRepeatRun: number // longest run of consecutive events with same (kind, detail)
}

export type SignalVerdict = 'CLEAR' | 'WARN' | 'ALARM'

export interface SignalReport {
  metrics: SignalMetrics
  signals: FailureSignal[]
  verdict: SignalVerdict  // any alarm → ALARM; any warn → WARN; else CLEAR
}

export interface CompletionCheck {
  id: string            // check id, e.g. 'has-evidence'
  clause: string        // the clause the evidence must satisfy
}

export interface CompletionClaim {
  taskId: string
  summary: string
  evidence: string[]
  selfDeclared: boolean  // true when the model claimed completion itself
}

export interface CompletionVerdict {
  taskId: string
  status: 'PASS' | 'FAIL'
  reasons: string[]     // exact reasons on FAIL; empty on PASS
}

export interface VerifierFixture {
  id: string
  kind: 'positive' | 'negative'
  claim: CompletionClaim
  checks: CompletionCheck[]
  expected: 'PASS' | 'FAIL'
}

export interface VerifierStats {
  tpr: number  // positives correctly PASSed / total positives
  tnr: number  // negatives correctly FAILed / total negatives
  positives: number
  negatives: number
}

export interface ReplayPatch {
  index: number       // event index in the recorded stream to replace
  event: ObsEvent     // the replacement event (the "patch")
}

export interface ReplayResult {
  before: SignalReport
  after: SignalReport
  changed: string[]   // signal ids whose firing state changed, sorted
}

export interface ObservabilityConfig {
  enabled?: boolean
  windowSize?: number       // ring buffer cap, default 512
  pRatioAlarm?: number      // default 0.5
  evDeficitWarn?: number    // default 0.1
  repeatThreshold?: number  // default 3
}

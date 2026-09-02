/**
 * Alarm detectors consuming the DeepSeek Harness runtime event stream.
 *
 * Detectors fold over the replayable event projection and return alarm
 * signals: P-Ratio efficiency collapse, evidence-to-verdict deficit, and
 * repeated-call loops. Detectors are pure — they never mutate the stream or
 * model-visible history (golden rule).
 *
 * @module @atlasai/atsh-runtime-alarms
 */

export { ALARM_KINDS, detectAlarms, detectEvidenceDeficit, detectPRatio, detectRepeatedCalls } from './detectors.ts'
export type {
  Alarm,
  AlarmKind,
  AlarmSeverity,
  EvidenceDeficitOptions,
  PRatioOptions,
  RepeatedCallOptions,
} from './types.ts'

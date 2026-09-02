import { describe, expect, it } from 'vitest'
import {
  RuntimeEventStream,
  type RuntimeEvent,
} from '@atlasai/atsh-runtime-events'
import {
  detectAlarms,
  detectEvidenceDeficit,
  detectPRatio,
  detectRepeatedCalls,
} from '@atlasai/atsh-runtime-alarms'

/**
 * Alarm synthetic-stream spec.
 *
 * Cover the alarm contract the detectors exist for:
 *  1. Healthy stream stays quiet — a stream free of the failure conditions
 *     raises no alarm from any detector (and none from the aggregate runner),
 *     so alarms are not noise-prone false positives.
 *  2. Each synthetic failure stream fires its alarm — P-Ratio efficiency
 *     collapse, evidence-to-verdict deficit, and repeated-call loops each
 *     raise on a crafted stream with the right kind, severity, seq, and
 *     message, and respond to their tuning options.
 *  3. Detectors are pure folds — running a detect pass never mutates the
 *     source events (golden rule: the event stream is a diagnostic
 *     projection, and folding over it must not write model-visible history).
 *
 * These tests are self-targeted and deterministic: they build event arrays
 * in-memory, require no provider key, and run in milliseconds. They never
 * touch model-visible history, a real session, or the live stream buffer.
 */

function toolCall(seq: number, tool = `fs_read_${seq}`): RuntimeEvent {
  return { kind: 'tool/call', seq, ts: 1000 + seq, tool }
}

function modelCall(
  seq: number,
  inputTokens: number,
  outputTokens: number,
): RuntimeEvent {
  return {
    kind: 'model/call',
    seq,
    ts: 1000 + seq,
    model: 'deepseek-v4-flash',
    inputTokens,
    outputTokens,
  }
}

function judgeVote(
  seq: number,
  vote: 'pass' | 'fail' | 'replan',
  evidence = 'Both fixtures carry the cited observation.',
): RuntimeEvent {
  return { kind: 'judge/vote', seq, ts: 1000 + seq, voter: 'panel-a', vote, evidence }
}

/** A bare judge vote with NO evidence text (the deficit condition). */
function bareJudgeVote(seq: number, vote: 'pass' | 'fail' | 'replan'): RuntimeEvent {
  return { kind: 'judge/vote', seq, ts: 1000 + seq, voter: 'panel-b', vote }
}

function budgetState(seq: number, state = 'route'): RuntimeEvent {
  return { kind: 'budget/state', seq, ts: 1000 + seq, state, remaining: 90 }
}

function compact(seq: number): RuntimeEvent {
  return { kind: 'compaction', seq, ts: 1000 + seq, mode: 'verbatim', retainedBytes: 2048 }
}

/** The sort order detectAlarms emits kinds in — see ALARM_KINDS. */
const KIND_ORDER = ['evidence-deficit', 'p-ratio', 'repeated-call']

/**
 * A healthy stream: distinct tool calls (no repeat run), model calls with a
 * healthy ratio, judge votes all carrying evidence, and budget/compaction
 * events that never break a strict consecutive run because there is no run.
 */
function healthyStream(): RuntimeEvent[] {
  return [
    toolCall(1, 'fs_read_a'),
    modelCall(2, 40, 60),
    toolCall(3, 'fs_write'),
    modelCall(4, 20, 30),
    judgeVote(5, 'pass', 'Feature surface matches the spec.'),
    budgetState(6),
    judgeVote(7, 'fail', 'Output contract diverges from the design.'),
    compact(8),
  ]
}

describe('Healthy stream stays quiet', () => {
  it('does not raise from any detector', () => {
    const events = healthyStream()
    expect(detectEvidenceDeficit(events)).toEqual([])
    expect(detectPRatio(events)).toEqual([])
    expect(detectRepeatedCalls(events)).toEqual([])
  })

  it('detectAlarms returns no alarms for a healthy stream', () => {
    const events = healthyStream()
    expect(detectAlarms(events)).toEqual([])
  })
})

describe('P-Ratio efficiency collapse (detectPRatio)', () => {
  it('raises a critical alarm when output fraction falls below the min', () => {
    const events = [
      modelCall(1, 100, 2), // 2/102 = 0.0196 << 0.15
    ]
    const alarms = detectPRatio(events)
    expect(alarms).toHaveLength(1)
    expect(alarms[0]).toMatchObject({
      kind: 'p-ratio',
      severity: 'critical',
      seq: 1,
    })
    expect(alarms[0]?.message).toContain('P-Ratio')
  })

  it('stays quiet when the output fraction holds (aggregate over the window)', () => {
    const events = [
      modelCall(1, 40, 60), // 0.60
      modelCall(2, 20, 30), // 0.60
    ]
    expect(detectPRatio(events)).toEqual([])
  })

  it('stays silent when there are no model calls at all', () => {
    const events = [toolCall(1, 'fs_read_a'), judgeVote(2, 'pass', 'x')]
    expect(detectPRatio(events)).toEqual([])
  })

  it('respects a tuned minOutputFraction', () => {
    // 0.18 holds under the default 0.15 but trips a 0.2 floor.
    const events = [modelCall(1, 82, 18)] // 18/100 = 0.18
    expect(detectPRatio(events)).toEqual([])
    expect(detectPRatio(events, { minOutputFraction: 0.2 })).toHaveLength(1)
  })

  it('reports the first model call in the failing window as the alarm seq', () => {
    // First call is healthy; the window collapses on the second (massive input).
    // The detector reports `firstModelSeq` — the first model/call it saw.
    const events = [
      modelCall(1, 10, 20),  // ratio 0.667 alone
      modelCall(2, 1000, 5), // window ratio 25/1035 = ~0.024 << 0.15
    ]
    const alarms = detectPRatio(events)
    expect(alarms).toHaveLength(1)
    expect(alarms[0]?.seq).toBe(1)
  })
})

describe('E-to-V (evidence-to-verdict) deficit detector (detectEvidenceDeficit)', () => {
  it('raises a warning for a pass verdict with no evidence', () => {
    const events = [bareJudgeVote(1, 'pass')]
    const alarms = detectEvidenceDeficit(events)
    expect(alarms).toHaveLength(1)
    expect(alarms[0]).toMatchObject({
      kind: 'evidence-deficit',
      severity: 'warning',
      seq: 1,
    })
  })

  it('raises critical for a REPLAN verdict with no evidence', () => {
    const events = [bareJudgeVote(1, 'replan')]
    expect(detectEvidenceDeficit(events)[0]?.severity).toBe('critical')
  })

  it('stays silent when the ballot carries evidence', () => {
    const events = [judgeVote(1, 'fail', 'Verified: the delta is absent.')]
    expect(detectEvidenceDeficit(events)).toEqual([])
  })

  it('names the voter and the deficit in the message', () => {
    const alarms = detectEvidenceDeficit([bareJudgeVote(1, 'fail')])
    expect(alarms[0]?.message).toContain('panel-b')
    expect(alarms[0]?.message).toContain('no evidence')
  })

  it('honors a tuned minEvidenceChars', () => {
    // Evidence 'x' is short but over the default 1; raise the floor to trip it.
    const events = [judgeVote(1, 'pass', 'x')]
    expect(detectEvidenceDeficit(events)).toEqual([])
    expect(detectEvidenceDeficit(events, { minEvidenceChars: 8 })).toHaveLength(1)
  })

  it('ignores non-vote events', () => {
    const events = [toolCall(1, 'fs_read'), modelCall(2, 10, 5)]
    expect(detectEvidenceDeficit(events)).toEqual([])
  })
})

describe('Repeated-call loop detector (detectRepeatedCalls)', () => {
  const repeatedRuns = (n: number): RuntimeEvent[] =>
    Array.from({ length: n }, (_, i) => toolCall(i + 1, 'fs_read_loop'))

  it('raises once a consecutive run of the same tool crosses the threshold', () => {
    const alarms = detectRepeatedCalls(repeatedRuns(3))
    expect(alarms).toHaveLength(1)
    expect(alarms[0]).toMatchObject({
      kind: 'repeated-call',
      severity: 'warning',
      seq: 1,
    })
  })

  it('escalates to critical when a run persists past the threshold', () => {
    // warning fires at the threshold crossing (runCount === threshold), then a
    // second critical alarm fires once the run extends past it. This is the
    // the corrections pass fix — critical is now reachable on an identifiable persisting
    // run (previously a latent dead branch).
    const alarms = detectRepeatedCalls(repeatedRuns(8))
    expect(alarms).toHaveLength(2)
    expect(alarms[0]).toMatchObject({ kind: 'repeated-call', severity: 'warning', seq: 1 })
    expect(alarms[1]).toMatchObject({ kind: 'repeated-call', severity: 'critical', seq: 1 })
  })

  it('stays warning-only when the run ends exactly at the threshold', () => {
    // A run that stops at the crossing never persists past it, so it carries a
    // single warning alarm — the escalation requires a run past the threshold.
    const alarms = detectRepeatedCalls(repeatedRuns(3))
    expect(alarms).toHaveLength(1)
    expect(alarms[0]?.severity).toBe('warning')
  })

  it('names the tool and the run length', () => {
    const alarms = detectRepeatedCalls(repeatedRuns(3))
    expect(alarms[0]?.message).toContain('fs_read_loop')
    expect(alarms[0]?.message).toContain('3x')
  })

  it('stays quiet below the threshold', () => {
    expect(detectRepeatedCalls(repeatedRuns(2))).toEqual([])
  })

  it('breaks a strict consecutive run when any other event kind intervenes', () => {
    const events = [toolCall(1, 'fs_read'), budgetState(2), toolCall(3, 'fs_read'), toolCall(4, 'fs_read')]
    expect(detectRepeatedCalls(events)).toEqual([])
  })

  it('fires in loose mode even with interleaved events', () => {
    const events = [toolCall(1, 'fs_read'), budgetState(2), toolCall(3, 'fs_read'), toolCall(4, 'fs_read')]
    const alarms = detectRepeatedCalls(events, { strictConsecutive: false })
    expect(alarms).toHaveLength(1)
  })

  it('fires once per firing level, not once per call', () => {
    // A persisting run yields exactly two alarms total (warning + critical),
    // never one per call — the guard tracks each level once.
    const alarms = detectRepeatedCalls(repeatedRuns(6))
    expect(alarms).toHaveLength(2)
    expect(alarms.map(a => a.severity)).toEqual(['warning', 'critical'])
  })

  it('honors a tuned repeatThreshold', () => {
    // Two is under the default 3 but trips a tuned 2.
    expect(detectRepeatedCalls(repeatedRuns(2), { repeatThreshold: 2 })).toHaveLength(1)
  })
})

describe('detectAlarms — the aggregate runner', () => {
  it('folds every detector once and emits alarms in stable per-kind order', () => {
    const events = [
      modelCall(1, 100, 5),        // P-ratio collapse
      bareJudgeVote(2, 'pass'),    // evidence deficit
      toolCall(3, 'fs_loop'),
      toolCall(4, 'fs_loop'),
      toolCall(5, 'fs_loop'),      // repeated call
    ]
    const alarms = detectAlarms(events)
    const kinds = alarms.map(a => a.kind)
    // One alarm of each kind, in ALARM_KINDS order: evidence-deficit, p-ratio, repeated-call.
    expect(kinds).toEqual(KIND_ORDER)
    // seqs point at the triggering events.
    expect(alarms.map(a => a.seq)).toEqual([2, 1, 3])
  })

  it('passes per-kind options through to the underlying detectors', () => {
    const events = [
      modelCall(1, 90, 10),
      bareJudgeVote(2, 'fail'),
      toolCall(3, 'fs_loop'),
      toolCall(4, 'fs_loop'),
    ]
    // Tuned: P-ratio floor up (fires on 0.1), repeated-call threshold down (fires at 2).
    const alarms = detectAlarms(events, {
      pRatio: { minOutputFraction: 0.2 },
      repeatedCall: { repeatThreshold: 2 },
    })
    expect(alarms.map(a => a.kind).sort()).toEqual(['evidence-deficit', 'p-ratio', 'repeated-call'])
  })
})

describe('Golden rule — detectors never mutate their source events', () => {
  it('leaves a stream snapshot byte-identical across a detect pass', () => {
    const stream = new RuntimeEventStream()
    const events = [
      modelCall(1, 100, 5),
      bareJudgeVote(2, 'pass'),
      toolCall(3, 'fs_loop'),
      toolCall(4, 'fs_loop'),
      toolCall(5, 'fs_loop'),
    ]
    for (const event of events) stream.append(event)
    const before = JSON.stringify(stream.snapshot())

    detectAlarms(stream.snapshot())

    const after = JSON.stringify(stream.snapshot())
    expect(after).toBe(before)
  })

  it('does not reject the source even when an alarm fires (frozen projection intact)', () => {
    const events = healthyStream()
    const before = JSON.stringify(events)
    detectAlarms(events)
    expect(JSON.stringify(events)).toBe(before)
  })
})

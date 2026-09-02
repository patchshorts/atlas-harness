// Event-stream fixtures for the observability package (Fix 3/6/7).
//
// Five named streams, each an `ObsEvent[]`. Every event has a distinct `ts`
// (1..N) and a kind drawn from the real-looking set ('judge/ballot',
// 'budget/route', 'fs_read', 'web_search', 'judge/replan', 'budget/veto',
// 'lane/veto', 'judge/verdict', 'factory/contract-registered'). No stream
// contains a consecutive (kind, detail) repeat beyond what its alarm demands.

import type { ObsEvent } from '../../src/types.ts'

export const EVENT_STREAMS: {
  healthy: ObsEvent[]
  planHeavy: ObsEvent[]
  evDeficit: ObsEvent[]
  pxpSpiral: ObsEvent[]
  repeatedCalls: ObsEvent[]
} = {
  /**
   * 14 events: plan 2, explore 5, evaluate 4, verify 3 — all distinct
   * consecutive (kind, detail) pairs. Expect CLEAR, pRatio 2/14 ≈ 0.143,
   * eToV 3/7 ≈ 0.429, pxpSpirals 0, maxRepeatRun 1.
   */
  healthy: [
    { ts: 1, stage: 'plan', kind: 'judge/replan', detail: 'r1' },
    { ts: 2, stage: 'explore', kind: 'budget/route', detail: 'route-1' },
    { ts: 3, stage: 'evaluate', kind: 'judge/ballot', detail: 'ballot-1' },
    { ts: 4, stage: 'verify', kind: 'judge/verdict', detail: 'verdict-1' },
    { ts: 5, stage: 'plan', kind: 'factory/contract-registered', detail: 'c1' },
    { ts: 6, stage: 'explore', kind: 'web_search', detail: 'web-1' },
    { ts: 7, stage: 'evaluate', kind: 'budget/veto', detail: 'veto-1' },
    { ts: 8, stage: 'explore', kind: 'fs_read', detail: 'x.txt' },
    { ts: 9, stage: 'verify', kind: 'judge/verdict', detail: 'verdict-2' },
    { ts: 10, stage: 'explore', kind: 'budget/route', detail: 'route-2' },
    { ts: 11, stage: 'explore', kind: 'web_search', detail: 'web-2' },
    { ts: 12, stage: 'evaluate', kind: 'judge/ballot', detail: 'ballot-2' },
    { ts: 13, stage: 'verify', kind: 'judge/verdict', detail: 'verdict-3' },
    { ts: 14, stage: 'evaluate', kind: 'lane/veto', detail: 'lane-1' },
  ],

  /**
   * 12 events: plan 8, explore 2, evaluate 1, verify 1. Expect pRatio
   * 8/12 ≈ 0.667 > 0.5 → 'high-p-ratio' alarm fires; verdict ALARM.
   */
  planHeavy: [
    { ts: 1, stage: 'plan', kind: 'judge/replan', detail: 'r1' },
    { ts: 2, stage: 'plan', kind: 'factory/contract-registered', detail: 'c1' },
    { ts: 3, stage: 'plan', kind: 'judge/replan', detail: 'r2' },
    { ts: 4, stage: 'plan', kind: 'factory/contract-registered', detail: 'c2' },
    { ts: 5, stage: 'plan', kind: 'judge/replan', detail: 'r3' },
    { ts: 6, stage: 'plan', kind: 'judge/replan', detail: 'r4' },
    { ts: 7, stage: 'plan', kind: 'judge/replan', detail: 'r5' },
    { ts: 8, stage: 'plan', kind: 'judge/replan', detail: 'r6' },
    { ts: 9, stage: 'explore', kind: 'budget/route', detail: 'route-1' },
    { ts: 10, stage: 'explore', kind: 'web_search', detail: 'web-1' },
    { ts: 11, stage: 'evaluate', kind: 'judge/ballot', detail: 'ballot-1' },
    { ts: 12, stage: 'verify', kind: 'judge/verdict', detail: 'verdict-1' },
  ],

  /**
   * 18 events: plan 2, explore 5, evaluate 10, verify 1. Expect eToV
   * 1/11 ≈ 0.091 < 0.1 → 'e-to-v-deficit' warn fires; verdict WARN (only
   * warn — pRatio 2/18 ≈ 0.111 < 0.5, pxpSpirals 0, maxRepeatRun 1).
   */
  evDeficit: [
    { ts: 1, stage: 'plan', kind: 'judge/replan', detail: 'r1' },
    { ts: 2, stage: 'explore', kind: 'budget/route', detail: 'route-1' },
    { ts: 3, stage: 'explore', kind: 'web_search', detail: 'web-1' },
    { ts: 4, stage: 'explore', kind: 'fs_read', detail: 'a.ts' },
    { ts: 5, stage: 'evaluate', kind: 'judge/ballot', detail: 'ballot-1' },
    { ts: 6, stage: 'evaluate', kind: 'budget/veto', detail: 'veto-1' },
    { ts: 7, stage: 'evaluate', kind: 'lane/veto', detail: 'lane-1' },
    { ts: 8, stage: 'plan', kind: 'factory/contract-registered', detail: 'c1' },
    { ts: 9, stage: 'explore', kind: 'budget/route', detail: 'route-2' },
    { ts: 10, stage: 'evaluate', kind: 'judge/ballot', detail: 'ballot-2' },
    { ts: 11, stage: 'evaluate', kind: 'budget/veto', detail: 'veto-2' },
    { ts: 12, stage: 'evaluate', kind: 'lane/veto', detail: 'lane-2' },
    { ts: 13, stage: 'explore', kind: 'web_search', detail: 'web-2' },
    { ts: 14, stage: 'evaluate', kind: 'judge/ballot', detail: 'ballot-3' },
    { ts: 15, stage: 'evaluate', kind: 'budget/veto', detail: 'veto-3' },
    { ts: 16, stage: 'evaluate', kind: 'lane/veto', detail: 'lane-3' },
    { ts: 17, stage: 'evaluate', kind: 'judge/ballot', detail: 'ballot-4' },
    { ts: 18, stage: 'verify', kind: 'judge/verdict', detail: 'verdict-1' },
  ],

  /**
   * 9 events with a plan→explore→plan trigram at indices 0-2 AND another
   * at indices 3-5: plan, explore, plan, plan, explore, plan, evaluate,
   * verify, explore. Expect pxpSpirals 2 → 'plan-explore-plan-spiral'
   * alarm fires; verdict ALARM.
   */
  pxpSpiral: [
    { ts: 1, stage: 'plan', kind: 'judge/replan', detail: 'r1' },
    { ts: 2, stage: 'explore', kind: 'budget/route', detail: 'route-1' },
    { ts: 3, stage: 'plan', kind: 'factory/contract-registered', detail: 'c1' },
    { ts: 4, stage: 'plan', kind: 'judge/replan', detail: 'r2' },
    { ts: 5, stage: 'explore', kind: 'web_search', detail: 'web-1' },
    { ts: 6, stage: 'plan', kind: 'judge/replan', detail: 'r3' },
    { ts: 7, stage: 'evaluate', kind: 'judge/ballot', detail: 'ballot-1' },
    { ts: 8, stage: 'verify', kind: 'judge/verdict', detail: 'verdict-1' },
    { ts: 9, stage: 'explore', kind: 'fs_read', detail: 'x.txt' },
  ],

  /**
   * 12 events where kind 'fs_read' with detail 'x.txt' repeats 4
   * consecutive times (indices 2-5). Expect maxRepeatRun 4 >= 3 →
   * 'repeated-identical-calls' alarm fires.
   */
  repeatedCalls: [
    { ts: 1, stage: 'plan', kind: 'judge/replan', detail: 'r1' },
    { ts: 2, stage: 'explore', kind: 'budget/route', detail: 'route-1' },
    { ts: 3, stage: 'explore', kind: 'fs_read', detail: 'x.txt' },
    { ts: 4, stage: 'explore', kind: 'fs_read', detail: 'x.txt' },
    { ts: 5, stage: 'explore', kind: 'fs_read', detail: 'x.txt' },
    { ts: 6, stage: 'explore', kind: 'fs_read', detail: 'x.txt' },
    { ts: 7, stage: 'evaluate', kind: 'judge/ballot', detail: 'ballot-1' },
    { ts: 8, stage: 'evaluate', kind: 'budget/veto', detail: 'veto-1' },
    { ts: 9, stage: 'verify', kind: 'judge/verdict', detail: 'verdict-1' },
    { ts: 10, stage: 'explore', kind: 'web_search', detail: 'web-1' },
    { ts: 11, stage: 'evaluate', kind: 'lane/veto', detail: 'lane-1' },
    { ts: 12, stage: 'plan', kind: 'factory/contract-registered', detail: 'c1' },
  ],
}

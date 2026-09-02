/**
 * gen_waste_appendix.ts — emit the waste-ratio PRIMARY appendix section from an
 * existing run log's per-session session-logs.
 *
 * Single source of truth: computeWasteRatio / computeTurnWasteRatio in
 * packages/bench/bench/src/report/stats.ts (the T1.1/T1.2 canonical, tested
 * implementations). This generator is the appendix side of the metric-first
 * milestone (PLAN T1.3).
 *
 * Usage:
 *   node --import tsx/esm docs/paper/scripts/gen_waste_appendix.ts \
 *     <session-logs-arm-dir> <run-id-label> <arm-label>
 *
 * Example:
 *   node --import tsx/esm docs/paper/scripts/gen_waste_appendix.ts \
 *     /home/cgodwin/bench-runs/paper-clean-additive-20260820/session-logs/additive \
 *     paper-clean-additive-20260820 additive
 *
 * Prints a self-contained markdown block to stdout (append into data-appendix.md).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readSessionLogFile } from '../../../packages/bench/bench/src/run/export.ts'
import { computeWasteRatio, computeTurnWasteRatio } from '../../../packages/bench/bench/src/report/stats.ts'

interface Row {
  task: string
  calls: number
  wasted: number
  ratio: number
  turns: number
}

function emit(armDir: string, runId: string, arm: string): void {
  const files = readdirSync(armDir).filter((f) => f.endsWith('.jsonl')).sort()
  const rows: Row[] = []
  let totalCalls = 0
  let wastedCalls = 0
  let n = 0
  let sumMean = 0
  let skipped = 0
  for (const f of files) {
    const task = f.replace(/\.jsonl$/, '')
    const loaded = readSessionLogFile(join(armDir, f))
    if (!loaded || loaded.events.length === 0) {
      skipped += 1
      continue
    }
    const r = computeWasteRatio(loaded.events)
    const t = computeTurnWasteRatio(loaded.events)
    totalCalls += r.totalCalls
    wastedCalls += r.wastedCalls
    sumMean += r.wasteRatio
    n += 1
    rows.push({
      task,
      calls: r.totalCalls,
      wasted: r.wastedCalls,
      ratio: r.totalCalls > 0 ? r.wastedCalls / r.totalCalls : 0,
      turns: t.turns.length,
    })
  }
  const pooled = n > 0 && totalCalls > 0 ? wastedCalls / totalCalls : 0
  const mean = n > 0 ? sumMean / n : 0

  rows.sort((a, b) => a.task.localeCompare(b.task))

  const out: string[] = []
  out.push('## 8. Waste-ratio (primary) — ' + arm + ' arm')
  out.push('')
  out.push(`Computed by the appendix generator (\`docs/paper/scripts/gen_waste_appendix.ts\`) from the retained run \`${runId}\` (${arm} arm, per-session logs, \`${n}\` sessions; \`${skipped}\` empty logs skipped). The waste-ratio definition is the broaden-design primary: wasted_calls = error calls + no-op edits (pre==post content hash) + post-outcome calls, over total calls.`)
  out.push('')
  out.push(`- Pooled waste-ratio (wasted/total across the ${arm} arm): **${pooled.toFixed(3)}**`)
  out.push(`- Mean per-session waste-ratio: **${mean.toFixed(3)}**`)
  out.push(`- Total calls: ${totalCalls}; wasted calls: ${wastedCalls}`)
  out.push('')
  out.push('| task | calls | wasted | per-session ratio | turns |')
  out.push('|:---|:---:|:---:|:---:|:---:|')
  for (const row of rows) {
    out.push(`| ${row.task} | ${row.calls} | ${row.wasted} | ${row.ratio.toFixed(3)} | ${row.turns} |`)
  }
  out.push('')
  out.push(`Provenance note: corr-g242-run1's raw per-call session logs were deleted (commit b540d9f); its aggregate table cannot yield the waste-ratio primary (needs per-call error/no-op/post-outcome detail). This section is computed from the only complete retained per-call run (${runId}), and the T7 harbor re-run records the authoritative per-turn primary on the new log. No number here is the paper's corr-g242-run1 — do not cross-reference it as such.`)
  out.push('')
  process.stdout.write(out.join('\n'))
}

const [armDir, runId, arm] = process.argv.slice(2)
if (!armDir || !runId || !arm) {
  console.error('usage: gen_waste_appendix <session-logs-arm-dir> <run-id> <arm>')
  process.exit(1)
}
emit(armDir, runId, arm)

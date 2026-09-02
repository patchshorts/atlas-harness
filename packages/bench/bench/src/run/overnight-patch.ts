/**
 * `bench-overnight-patch` — overnight self-patch.
 *
 * The final step of the corrections loop runs AFTER the day: it consumes a
 * directory of exported session logs (yesterday's C1..C5 session logs — the
 * same .jsonl shape bench-classify consumes), clusters the corrections
 * across those logs to find RECURRING ones, and drafts a run-end artifact —
 * a drafted SKILL.md or a mistake-ledger entry — for human review. This is
 * the overnight self-patch that recomposes the plan + coordination + critic
 * subsystems into a loop that learns from its own corrections.
 *
 * The module is an ADD (packages/bench); it never touches a frozen upstream
 * file. The decision layer is pure functions (unit-testable without booting
 * the harness — deferred-verification contract, self-targeted fast spec):
 * the read + cluster + draft pipeline is deterministic, and only the
 * coordinator touches the real filesystem (reading the log directory +
 * writing the artifact file).
 *
 * @module @atlasai/atsh-bench/run/overnight-patch
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { classifySession } from '../classify/classify.ts'
import type { ClassifierConfig, CorrectionHit } from '../classify/types.ts'
import type { LoadedSessionLog } from './export.ts'
import { readSessionLogFile } from './export.ts'

/** Stable Cordis plugin name (matches the barrel export + home-patch row). */
export const name = 'bench-overnight-patch'

/** Config for the overnight self-patch module, validated fail-loud at load. */
export interface Config {
  /** Optional classifier config override (defaults mirror the frozen bench manifest). */
  classifier?: Partial<ClassifierConfig>
}

export const Config: z<Config> = z.object({})

/**
 * One cluster of recurring corrections: the same correction class + the
 * same tool/path/token, counted across the session logs.
 */
export interface CorrectionCluster {
  /** Stable cluster key — `${class}:${token}`. */
  key: string
  /** The correction class (C1..C5). */
  class: string
  /** The tool/path/token extracted from the correction note. */
  token: string
  /** How many times this exact correction recurred. */
  count: number
  /** First sample note for human grounding (earliest by seq). */
  sampleNote: string
}

/**
 * Extract a stable, class-appropriate token from a correction note. The
 * classifier's note carries the tool/path/todo content that identifies the
 * corrected surface; parse the known shapes and fall back to the class name.
 *
 * @param hit - one correction hit.
 * @returns the token identifying the corrected surface.
 */
export function correctionClusterToken(hit: CorrectionHit): string {
  const note = hit.note ?? ''
  const retry = /retry of (\S+)/.exec(note)
  if (retry !== null && retry[1] !== undefined) return retry[1]
  const restore = /restore of (\S+)/.exec(note)
  if (restore !== null && restore[1] !== undefined) return restore[1]
  const todo = /todo "([^"]+)"/.exec(note)
  if (todo !== null && todo[1] !== undefined) return todo[1]
  return hit.class
}

/**
 * Cluster correction hits by class + token so recurring corrections — the
 * same tool retried, the same path reverted, the same todo flipped — are
 * identified and counted once per surface. Pure function, unit-testable.
 *
 * @param hits - The corrections to cluster.
 * @returns clusters ordered by descending recurrence count.
 */
export function clusterCorrections(hits: readonly CorrectionHit[]): CorrectionCluster[] {
  const byKey = new Map<string, { cluster: CorrectionCluster; firstSeq: number }>()
  for (const hit of hits) {
    const token = correctionClusterToken(hit)
    const key = `${hit.class}:${token}`
    const existing = byKey.get(key)
    if (existing === undefined) {
      byKey.set(key, {
        cluster: { key, class: hit.class, token, count: 1, sampleNote: hit.note },
        firstSeq: hit.seq,
      })
    } else {
      existing.cluster.count += 1
      if (hit.seq < existing.firstSeq) {
        existing.firstSeq = hit.seq
        existing.cluster.sampleNote = hit.note
      }
    }
  }
  return [...byKey.values()]
    .map(entry => entry.cluster)
    .sort((a, b) => b.count - a.count)
}

/**
 * Load every `session.jsonl` directly under a directory, using the same
 * plain-JSONL reader the classifier consumes. Unreadable files are skipped
 * (the tolerance `readSessionLogFile` already applies).
 *
 * @param dir - the directory of session logs (yesterday's logs).
 * @returns the loaded session logs.
 */
export function loadSessionDirectory(dir: string): LoadedSessionLog[] {
  let names: string[]
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => entry.name)
  } catch {
    return []
  }
  const sessions: LoadedSessionLog[] = []
  for (const name of names) {
    const log = readSessionLogFile(join(resolve(dir), name))
    if (log !== null) sessions.push(log)
  }
  return sessions
}

/**
 * Cluster the corrections across a set of loaded session logs: classify each
 * session, flatten every correction hit, and cluster the recurring ones.
 *
 * @param sessions - The loaded session logs to cluster.
 * @param classifier - Optional classifier config override.
 * @returns clusters of recurring corrections across the sessions.
 */
export function clusterLogs(
  sessions: readonly LoadedSessionLog[],
  classifier: Partial<ClassifierConfig> = {},
): CorrectionCluster[] {
  const hits: CorrectionHit[] = []
  for (const session of sessions) {
    if (session === null) continue
    const classified = classifySession(session.events, classifier)
    hits.push(...classified.hits)
  }
  return clusterCorrections(hits)
}

/**
 * Draft the run-end artifact content — a researched SKILL.md prose block (or
 * a mistake-ledger entry) recommending mitigations for the recurring
 * corrections found overnight. Pure render, deterministic for the clusters.
 *
 * @param clusters - The recurring correction clusters (usually from
 *   {@link clusterLogs}).
 * @returns the drafted artifact text.
 */
export function draftOvernightHelp(clusters: readonly CorrectionCluster[]): string {
  const header =
    '# SKILL.md (drafted) — overnight self-patch recurring-correction mitigations\n\n' +
    'Drafted by `bench-overnight-patch` for human review. It clusters ' +
    'the corrections that recurred across the last session-log run so the next ' +
    'iteration learns the surfaces that keep failing. Apply or reject each ' +
    'mitigation before teaching it to the agent.\n\n'
  if (clusters.length === 0) {
    return header + 'No recurring corrections were found in the consumed logs.\n'
  }
  const lines = clusters.map((cluster, i) => {
    const proposed =
      cluster.count >= 3
        ? 'route this tool/token through the mistake ledger so the next identical ' +
          'attempt is vetoed and re-directs; the ledger pins "ALREADY TRIED ' +
          `${cluster.token}: <failure>" into the byte-stable core.`
        : cluster.count >= 2
          ? 'record this correction in the mistake ledger — it has now recurred twice.'
          : 'monitor only — single occurrence, no ledger pin yet.'
    return (
      `${i + 1}. ${cluster.class} corrections — "${cluster.token}" recurred ${cluster.count}x\n` +
      `   - sample: ${cluster.sampleNote}\n` +
      `   - ${proposed}\n`
    )
  })
  return header + `Recurring correction clusters (${clusters.length}):\n\n` + lines.join('\n')
}

/**
 * Write the drafted artifact to a file in the target directory. Creates the
 * directory when absent; writes with real filesystem semantics. Returns the
 * written path.
 *
 * @param clusters - The clusters to draft.
 * @param dir - The directory to write the artifact into.
 * @param fileName - Optional artifact file name (default `overnight-patch.md`).
 * @returns the absolute path of the written artifact.
 */
export function writeOvernightPatchArtifact(
  clusters: readonly CorrectionCluster[],
  dir: string,
  fileName: string = 'overnight-patch.md',
): string {
  const targetDir = resolve(dir)
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })
  const target = join(targetDir, fileName)
  writeFileSync(target, draftOvernightHelp(clusters), 'utf8')
  return target
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Diagnostic emitted when the overnight-patch coordinator drafts and
     * writes the artifact. Carries the artifact path + recurring-cluster
     * count. Never model-visible.
     * @param event - the overnight-patch payload.
     * @param event.artifactPath - path of the drafted artifact file.
     * @param event.clusters - number of recurring correction clusters found.
     * @param event.ts - emission timestamp (epoch ms).
     * @mode emit
     */
    'bench/overnight-patch'(
      event: {
        artifactPath: string
        clusters: number
        ts: number
      },
    ): void
  }
}

/**
 * Overnight-patch coordinator: load the log directory, cluster the
 * corrections, draft + write the run-end artifact, emit the diagnostic.
 * This is the reachable command a caller invokes at the end of a run.
 *
 * @param ctx - The plugin context (for the diagnostic event).
 * @param opts - The run options.
 * @returns the written artifact path.
 */
export function runOvernightPatch(
  ctx: Context,
  opts: {
    srcDir: string
    artifactDir?: string
    classifier?: Partial<ClassifierConfig>
    artifactFileName?: string
  },
): string {
  const sessions = loadSessionDirectory(opts.srcDir)
  const clusters = clusterLogs(sessions, opts.classifier)
  const artifact = writeOvernightPatchArtifact(
    clusters,
    opts.artifactDir ?? opts.srcDir,
    opts.artifactFileName,
  )
  ctx.emit('bench/overnight-patch', {
    artifactPath: artifact,
    clusters: clusters.length,
    ts: Date.now(),
  })
  return artifact
}

/**
 * Install the overnight-patch plugin. Config validates fail-loud at load;
 * the diagnostic event is emitted by {@link runOvernightPatch}, not in
 * `apply` (apply has no live boundary event to hook — the patch runs on
 * yesterday's logs).
 *
 * @param _ctx - Plugin context (unused; the run paths emit their own event).
 * @param _config - Validated {@link Config}.
 */
export function apply(_ctx: Context, _config: Config): void {}

export default { name, Config, apply }

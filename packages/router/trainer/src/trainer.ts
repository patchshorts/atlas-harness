/**
 * Auto-training sample queue for `@atlasai/atsh-router`: a service that consumes
 * `router/call-logged` records (one per routed model call) and exposes them as
 * `ctx.routerTrainer` for downstream training, with an optional JSONL output sink.
 *
 * Registers as the `routerTrainer` service (one per context; loading a second throws,
 * cordis' standard duplicate-service behavior). Mount alongside `@atlasai/atsh-router`
 * — the router emits `router/call-logged` after each call-log row lands.
 *
 * @module @atlasai/atsh-router-trainer/trainer
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CorrectionRecord, TrainingSample } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    routerTrainer: RouterTrainer
  }
}

const SUPPORTED_CONFIG_KEYS = new Set(['outputPath'])

/** Reject stale or misspelled config keys before defaults can hide them. */
function validateConfigKeys(config: TrainerConfig): void {
  for (const key of Object.keys(config)) {
    if (!SUPPORTED_CONFIG_KEYS.has(key)) {
      throw new Error(`RouterTrainerConfig: unknown key "${key}"`)
    }
  }
}

/** Configuration for the {@link RouterTrainer} service. */
export interface TrainerConfig {
  /** When set, append one JSONL line per logged call to this file (parents created). */
  outputPath?: string
}

/**
 * Collects one `router/call-logged` record per routed call as a training sample, in
 * arrival order, plus `CorrectionRecord` rewards threaded onto corrected samples. A
 * downstream trainer drains {@link records} (or the optional JSONL output sink) at its
 * own cadence; {@link reset} starts a fresh queue.
 */
export class RouterTrainer extends Service {
  static Config: z<TrainerConfig> = z.object({
    outputPath: z.string(),
  })

  private samples: TrainingSample[] = []

  /** Corrections consumed as rewards so far, in arrival order. */
  private readonly correctionRecords: CorrectionRecord[] = []

  private readonly outputFile: string | undefined

  constructor(ctx: Context, config: TrainerConfig = {}) {
    super(ctx, 'routerTrainer')
    validateConfigKeys(config)
    this.outputFile = config.outputPath === undefined ? undefined : resolve(config.outputPath)
    if (this.outputFile !== undefined) {
      mkdirSync(dirname(this.outputFile), { recursive: true, mode: 0o700 })
    }
    ctx.on('router/call-logged', (record) => {
      this.onCall(record)
    })
  }

  /**
   * Number of samples collected since the last {@link reset}.
   * @returns the sample count.
   */
  count(): number {
    return this.samples.length
  }

  /**
   * Samples collected so far, in arrival order.
   * @returns the collected training samples.
   */
  records(): readonly TrainingSample[] {
    return this.samples
  }

  /** Drop all collected samples (does not truncate an `outputPath` file). */
  reset(): void {
    this.samples = []
    this.correctionRecords.length = 0
  }

  /**
   * Corrections threaded into the trainer as rewards so far, in arrival order.
   * @returns the consumed correction records.
   */
  corrections(): readonly CorrectionRecord[] {
    return this.correctionRecords
  }

  /**
   * Samples whose call received a threaded correction reward, in arrival order. A
   * sample's {@link CorrectionRecord reward} is set only after a correction referenced
   * its call id, so this proves which corrections were consumed as rewards.
   * @returns the rewarded training samples.
   */
  rewards(): readonly TrainingSample[] {
    return this.samples.filter(sample => sample.reward !== undefined)
  }

  /**
   * Thread one correction into the trainer's sample log as a reward signal: append it to
   * the optional JSONL sink (the same `outputPath` log as the samples) and, when it
   * references a recorded call, attach it to that sample as its reward. A correction
   * referencing a call the trainer has not seen is still recorded, so no correction is
   * lost.
   * @param correction - the correction to consume as a reward.
   */
  recordCorrection(correction: CorrectionRecord): void {
    this.correctionRecords.push(correction)
    const sample = this.samples.find(entry => entry.id === correction.callId)
    if (sample !== undefined) {
      sample.reward = correction
    }
    if (this.outputFile !== undefined) {
      appendFileSync(this.outputFile, `${JSON.stringify(correction)}\n`, 'utf8')
    }
  }

  /**
   * Append one routed call record to the sample queue and the optional JSONL sink.
   * @param record - the routed call record to append.
   */
  onCall(record: TrainingSample): void {
    this.samples.push(record)
    if (this.outputFile !== undefined) {
      appendFileSync(this.outputFile, `${JSON.stringify(record)}\n`, 'utf8')
    }
  }
}

export default RouterTrainer

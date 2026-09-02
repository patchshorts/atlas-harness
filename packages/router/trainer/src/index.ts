/**
 * Auto-training consumer for `@atlasai/atsh-router`: the `routerTrainer` service
 * collects every `router/call-logged` record into `ctx.routerTrainer` for downstream
 * training, threads correction rewards onto corrected calls via
 * {@link RouterTrainer.recordCorrection}, and offers an optional JSONL output sink.
 *
 * Service package: default-exports the {@link RouterTrainer} service class (registers as
 * `ctx.routerTrainer`); mount alongside `@atlasai/atsh-router`.
 * @module @atlasai/atsh-router-trainer
 */

export { default, RouterTrainer } from './trainer.ts'
export type { TrainerConfig } from './trainer.ts'
export type { CorrectionRecord, TrainingSample } from './types.ts'

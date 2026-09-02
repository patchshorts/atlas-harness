// Factory capability family: plan-contract registry, deterministic BAR
// critic scoring, and planner/developer/critic role objectives over the
// ralph tool.

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A factory plan contract was registered or replaced.
     *
     * @mode emit
     * @param payload - The contract-registration event payload.
     */
    'factory/contract-registered'(payload: { planId: string; count: number }): void
  }
}

export { default, FactoryService } from './service.ts'

export type {
  BarStatus,
  BarSubmission,
  BarVerdict,
  ContractScore,
  FactoryConfig,
  FactoryPlanTask,
  PlannerInput,
} from './types.ts'

export { criticObjective, developerObjective, plannerObjective } from './roles.ts'

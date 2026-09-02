// Canonical type contracts for the factory capability family.
// Shared across the factory service, its tool plugin, and downstream
// consumers. Types only — no runtime code.

/** An atomic task contract row in a factory plan contract. */
export interface FactoryPlanTask {
  /** Unique task id within the plan contract. */
  id: string
  /** The verb of the atomic task, e.g. "implement". */
  verb: string
  /** The object of the atomic task, e.g. "the auth module". */
  object: string
  /** A concrete, checkable statement the task's completion must satisfy. */
  verifies: string
}

/** A model submission of work for a single atomic task of a plan contract. */
export interface BarSubmission {
  /** The atomic task id this submission addresses. */
  taskId: string
  /** A summary of what was done. */
  summary: string
  /** Evidence items backing the summary (commands run, artifacts, observations). */
  evidence: string[]
  /** File paths touched or produced by the work. */
  files: string[]
  /** Optional blockers preventing completion. */
  blockers?: string[]
}

/** The status of a single task submission after BAR scoring. */
export type BarStatus = 'PASS' | 'FAIL' | 'NOT_SUBMITTED'

/** The deterministic BAR judge verdict for one task submission. */
export interface BarVerdict {
  /** The scored task id. */
  taskId: string
  /** PASS when every required clause holds, FAIL otherwise. */
  status: BarStatus
  /** The clauses that were satisfied. */
  passedChecks: string[]
  /** The clauses that failed, one exact reason per failed clause. */
  reasons: string[]
}

/** Aggregate score for a whole plan contract. */
export interface ContractScore {
  /** The scored plan contract id. */
  planId: string
  /** Total number of tasks in the contract. */
  total: number
  /** Number of tasks that received a submission. */
  submitted: number
  /** Number of tasks that passed BAR scoring. */
  passed: number
  /** Number of tasks that failed BAR scoring. */
  failed: number
  /** ALL_PASS when every task passed, FAIL otherwise. */
  verdict: 'ALL_PASS' | 'FAIL'
}

/** Configuration for the factory service. */
export interface FactoryConfig {
  /** Whether plan-contract registration is accepted. Default true. */
  enabled?: boolean
  /** Maximum number of tasks a single plan contract may contain. Default 100. */
  maxPlanTasks?: number
}

/** Input to the planner role-objective builder. */
export interface PlannerInput {
  /** The scope the plan must decompose. */
  scope: string
  /** Optional constraints the plan must respect. */
  constraints?: string[]
}

// Canonical type contracts for the Pass 4 unanimous three-panel judge
// (`ctx.factoryJudge`). Types only — no runtime code.

/** The judgment surface: a plan gate, a failure triage, or a completion verdict. */
export type JudgeKind = 'plan' | 'triage' | 'completion'

/** One of the three independent panel roles (fresh context per role). */
export type JudgePanelRole = 'decomposition' | 'feasibility' | 'verification'

/** One ballot cast by one panel role for one judgment round. */
export interface JudgeVote {
  /** The panel role that cast the ballot. */
  role: JudgePanelRole
  /** The judgment this ballot belongs to. */
  judgmentId: string
  /** The plan id under judgment. */
  planId: string
  /** The judgment surface. */
  kind: JudgeKind
  /** The role's vote. */
  vote: 'YES' | 'NO'
  /** Exact reasons for the vote, citing the artifact. */
  reasons: string[]
}

/** An atomic task row in a judged plan. */
export interface JudgePlanTask {
  /** Unique task id within the plan. */
  id: string
  /** The verb of the atomic task, e.g. "implement". */
  verb: string
  /** The object of the atomic task, e.g. "the auth module". */
  object: string
  /** A concrete, checkable statement the task's completion must satisfy. */
  verifies: string
}

/** A claimed completion: summary plus evidence and file paths. */
export interface JudgeSubmission {
  /** What was done, as a normalized string. */
  summary: string
  /** Evidence items backing the summary. */
  evidence: string[]
  /** File paths touched or produced. */
  files: string[]
}

/** A failure triage: what failed, the next action, and evidence. */
export interface JudgeTriage {
  /** What failed, as a normalized string. */
  failure: string
  /** The concrete next action, as a normalized string. */
  nextAction: string
  /** Evidence backing the triage. */
  evidence: string[]
}

/** A judgment request; the only input the deterministic panel sees. */
export interface JudgeRequest {
  /** Judgment id; replan budget is tracked per judgment id. */
  judgmentId: string
  /** The plan id under judgment. */
  planId: string
  /** The plan revision under judgment. */
  revision: string
  /** The judgment surface. */
  kind: JudgeKind
  /** The plan tasks; required for kind 'plan', used for all kinds. */
  tasks: JudgePlanTask[]
  /** The claimed completion; required for kind 'completion'. */
  submission?: JudgeSubmission
  /** The failure triage; required for kind 'triage'. */
  triage?: JudgeTriage
  /** 'single' judges with the decomposition role only; default 'panel'. */
  mode?: 'single' | 'panel'
  /** Accounting account for replan charges; default 'default'. */
  account?: string
}

/** The aggregate verdict after one vote round. */
export type JudgeVerdictKind = 'PASS' | 'REPLAN' | 'ESCALATE'

/** The settled outcome of one judgment round. */
export interface JudgeVerdict {
  /** The judgment id. */
  judgmentId: string
  /** The plan id under judgment. */
  planId: string
  /** The plan revision under judgment. */
  revision: string
  /** The judgment surface. */
  kind: JudgeKind
  /** Whether the panel was single-role or three-role. */
  mode: 'single' | 'panel'
  /** PASS when every ballot is YES; REPLAN/ESCALATE on any NO. */
  verdict: JudgeVerdictKind
  /** 1-based vote round. */
  round: number
  /** Every ballot cast this round. */
  ballots: JudgeVote[]
  /** Replans granted for this judgment so far (including this round). */
  replansUsed: number
  /** Replans still available for this judgment. */
  replansRemaining: number
  /** Tokens charged THIS round (replanCost on REPLAN, 0 otherwise). */
  replanCostCharged: number
}

/** Configuration for the judge service. */
export interface JudgeConfig {
  /** Whether judge() accepts judgments. Default true. */
  enabled?: boolean
  /** Maximum replans per judgment before escalation. Default 3. */
  maxReplans?: number
  /** Token charge per replan. Default 1500. */
  replanCost?: number
}

/** Read-side replan budget for one judgment. */
export interface JudgeReplanState {
  /** Replans granted so far. */
  replansUsed: number
  /** Replans still available. */
  maxReplans: number
}

/** A recorded plan approval: plan id → approved revision. */
export interface JudgeApprovalRecord {
  /** The approved plan id. */
  planId: string
  /** The approved revision. */
  revision: string
  /** Approval timestamp (epoch ms). */
  at: number
}

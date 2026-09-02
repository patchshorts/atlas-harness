// Types only — no runtime code (packages/AGENTS.md).

/** The four trust lanes the harness separates. */
export type Channel = 'system' | 'user' | 'tool' | 'assistant'

/** A message with its derived lane channel and authority. */
export interface ChanneledMessage {
  role: string
  content: string
  channel: Channel
  authority: number // system=3 > user=2 = assistant=2 > tool=1
}

/** The tool-call allow/deny policy. */
export interface AllowPolicy {
  allow: string[] // glob patterns; non-empty => default-deny everything else
  deny: string[] // deny wins over allow
}

/** The outcome of evaluating one tool call against the policy. */
export interface AllowDecision {
  allowed: boolean
  reason?: string // present when denied
  matched: string | null // the matching allow pattern, or null
}

/** One sanitize-pass strip: where it fired and which rule fired. */
export interface SanitizeHit {
  index: number // char index of the strip start
  marker: string // which rule fired ('marker:ignore previous instructions' | 'spoof:LANE 1' | 'encoded:base64' | ...)
}

/** The outcome of one sanitize pass over a text. */
export interface SanitizeResult {
  text: string
  hits: SanitizeHit[]
  stripped: number // total chars removed
}

/** A fact triple extracted from CONTENT (subject, predicate, object). */
export interface FactTriple {
  subject: string
  predicate: string
  object: string
}

/** Taint-aware verification verdict for a composed output. */
export interface TaintVerdict {
  verified: boolean
  traced: number // output clauses that traced to a triple
  untraced: string[] // clause texts that traced to no triple
}

/** The injection taxonomy class: 1 explicit, 2 tool-directive, 3 in-band/spoof. */
export type PayloadClass = 1 | 2 | 3

/** One injection payload from the 22-payload fixture taxonomy. */
export interface InjectionPayload {
  id: string // taxonomy id, e.g. 'direct-command', 'lane-1-replica'
  klass: PayloadClass
  content: string // the injection text as it would arrive inside tool output
  directedTool?: string // the tool call the payload tries to provoke, if any
}

/** The deterministic result of defending one payload. */
export interface DefenseResult {
  payloadId: string
  resisted: boolean
  via: 'sanitize' | 'allowlist' | 'none'
  detail?: string // sanitize hits or allowlist reason
}

/** Payload of the 'lane/veto' event: a tool call denied by the allowlist gate. */
export interface LaneVetoRecord {
  name: string
  reason: string
  ts: number
}

/** LaneGuardService config. */
export interface LaneGuardConfig {
  enabled?: boolean
  allow?: string[]
  deny?: string[]
  sanitize?: boolean // default true; false disables the sanitize pass
  taint?: boolean // default true; false disables taint verification
}

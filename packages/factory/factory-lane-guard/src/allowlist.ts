// Tool-call allowlist (the harness-boundary gate). Pure and deterministic —
// no I/O, no this: exact match or `*`-suffixed prefix match; deny wins over
// allow; an empty allow list is passive (everything allowed).

import type { AllowDecision, AllowPolicy } from './types.ts'

/**
 * Glob match against a pattern list: exact equality, or a `*`-suffixed
 * pattern is a prefix match (e.g. `fs_*` matches `fs_write`).
 *
 * @param name - the tool name to test.
 * @param patterns - the patterns to match against.
 * @returns true when any pattern matches the name.
 */
export function matchesAny(name: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith('*')) {
      if (name.startsWith(pattern.slice(0, -1))) return true
    } else if (name === pattern) {
      return true
    }
  }
  return false
}

/**
 * Evaluate one tool call against an allow/deny policy.
 *
 * @param name - the tool name.
 * @param policy - the allow/deny policy (deny wins over allow).
 * @returns the decision: allowed, the matching allow pattern, and the denial
 *   reason when denied.
 */
export function evaluateAllowlist(name: string, policy: AllowPolicy): AllowDecision {
  for (const pattern of policy.deny) {
    if (matchesAny(name, [pattern])) {
      return { allowed: false, reason: `tool "${name}" denied by deny rule "${pattern}"`, matched: null }
    }
  }
  if (policy.allow.length > 0) {
    for (const pattern of policy.allow) {
      if (matchesAny(name, [pattern])) {
        return { allowed: true, matched: pattern }
      }
    }
    return { allowed: false, reason: `tool "${name}" denied by allowlist`, matched: null }
  }
  return { allowed: true, matched: null }
}

/**
 * Normalize a pattern list: trim, drop empties, sort for determinism.
 *
 * @param patterns - raw patterns (e.g. from config).
 * @returns the canonical, sorted pattern list.
 */
export function compileRules(patterns: string[]): string[] {
  return patterns.map(pattern => pattern.trim()).filter(pattern => pattern.length > 0).sort()
}

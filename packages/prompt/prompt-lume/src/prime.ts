/**
 * `prompt-lume-live` — additive working-intent primer + corpus loader that makes
 * prompt-lume live in a harness profile (the L3 assembly seam GAF-ISSUE requires).
 *
 * Two responsibilities:
 *
 * 1. **Load**: on mount, ingest the workspace instruction corpora reachable from
 *    the process cwd (`AGENTS.md` / `CLAUDE.md` bodies) into the prompt-corpus
 *    index via `ctx.promptCorpus.ingest`. Without this the relevance-gated
 *    assembler has nothing to retrieve and the token-in reduction is unmeasurable.
 * 2. **Prime**: for each step, distills a cheap working-intent query from the
 *    claimed user messages (current user input + last agent tool/action text)
 *    and calls `ctx.promptLume.primeTurn(...)` BEFORE the next assembly so the
 *    relevance-gated assembler injects only the germane chunks for the turn.
 *
 * Mounted alongside prompt-lume in the additive harness profile (headless), so
 * the clamp arm (no prompt-lume) is the untouched baseline. Function plugin —
 * `name`/`inject`/`Config`/`apply` with NO default export, otherwise the Loader
 * discards the namespace (packages/AGENTS.md mount-form rule).
 *
 * @module @atlasai/atsh-prompt-lume/prime
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@atlasai/atsh-agent'
import type { Session } from '@atlasai/atsh-session'
import z from '@deepseek-ai/schemastery'
import type { TurnSurface } from './index.ts'

/** Plugin config — corpus discovery + priming switches. */
export interface PrimerConfig {
  /** Master on/off. Default true. */
  enabled?: boolean
  /** Root dir to walk for instruction files (default process.cwd()). */
  root?: string
  /** Max instruction bytes to ingest per file (defensive). Default 1 MiB. */
  maxFileBytes?: number
  /** The corpus name to tag ingested files (default agent-instructions). */
  corpus?: string
}

export const Config: z<PrimerConfig> = z.object({
  enabled: z.boolean().default(true),
  root: z.string().default(process.cwd()),
  maxFileBytes: z.number().default(1024 * 1024),
  corpus: z.string().default('agent-instructions'),
})

/**
 * Instruction corpora the primer ingests on mount. The FIRST three are
 * top-level workspace instruction files (AGENTS/CLAUDE/WORKSPACE); the last
 * two are the nested-file kinds the seed-source extension adds — a skill's
 * `SKILL.md` (skill dirs nest arbitrarily deep under `skills/`) and a persona
 * `SOUL.md` (persona dirs / subdirectories). A recursive walk collects any
 * file whose basename matches, so skill and persona corpora join the same
 * relevance-gated index without a separate registration surface.
 */
export const INSTRUCTION_FILENAMES = ['AGENTS.md', 'CLAUDE.md', 'WORKSPACE.md', 'SKILL.md', 'SOUL.md']

/** Read a file up to max bytes; returns text or undefined when too large/missing. */
function readBounded(file: string, maxBytes: number): string | undefined {
  try {
    const { size } = statSync(file)
    if (size > maxBytes) return undefined
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/** Extract plain text from a message payload. */
function messageText(m: { role: string; content: unknown }): string {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) {
    return m.content
      .map(p => p && typeof (p as { type?: string; text?: string }).text === 'string' ? (p as { text: string }).text : '')
      .join(' ')
  }
  return ''
}

/** Distill a cheap working-intent query from the claimed messages. */
function distill(messages: Array<{ role: string; content: unknown }>): string {
  const last = messages[messages.length - 1]
  if (last && last.role !== 'assistant') {
    const t = messageText(last)
    if (t.length > 0) return t
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const candidate = messages[i]
    if (candidate === undefined) continue
    const t = messageText(candidate)
    if (t.length > 0) return t
  }
  return ''
}

/** Walk root recursively for instruction files; returns absolute paths. */
export function collectInstructionFiles(root: string): string[] {
  const found: string[] = []
  try {
    const entries = readdirSync(root, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue
      if (entry.isDirectory()) {
        // Skill dirs and persona dirs nest under the workspace root, so the
        // walker must descend to seed skill (SKILL.md) + persona (SOUL.md)
        // corpora from their natural subdirectories.
        found.push(...collectInstructionFiles(join(root, entry.name)))
      } else if (entry.isFile() && INSTRUCTION_FILENAMES.includes(entry.name)) {
        found.push(join(root, entry.name))
      }
    }
  } catch {
    /* root missing / unreadable — nothing to ingest */
  }
  return found
}

/**
 * Distill a TurnSurface from the claimed messages and recent action.
 *
 * @param messages - the pre-step claimed user messages.
 * @returns the distilled working-intent turn surface, or undefined to skip priming.
 */
export function distillTurn(messages: Array<{ role: string; content: unknown }>): TurnSurface | undefined {
  const intent = distill(messages)
  if (intent.length === 0) return undefined
  const lower = intent.toLowerCase()
  const kind =
    /\b(tool|command|bash|run|terminal|shell|execute|test)\b/.test(lower)
      ? 'tool'
      : /\b(import|workspace|module|package|repo|directory)\b/.test(lower)
        ? 'workspace'
        : /\b(profile|identity|who are you|persona)\b/.test(lower)
          ? 'identity'
          : 'general'
  return { intent, kind }
}

export const name = 'prompt-lume-prime'

export const inject = ['promptCorpus', 'promptLume']

export const apply = (ctx: Context, config: PrimerConfig): void => {
  if (!config.enabled) return
  const root = resolve(config.root ?? process.cwd())
  // Ingest at mount: load every instruction file from cwd into the corpus so
  // recall has a wall to replace.
  for (const file of collectInstructionFiles(root)) {
    const text = readBounded(file, config.maxFileBytes ?? 1024 * 1024)
    if (text !== undefined && text.length > 0) {
      void ctx.promptCorpus.ingest(text, {
        corpus: config.corpus ?? 'agent-instructions',
        scope: 'workspace',
      }).catch(() => {
        /* best-effort ingest; a missing memory store must not break the boot */
      })
    }
  }
  // Prime per step so the NEXT assembly is relevance-gated, then flush the
  // region the current assembly staged as a tail user/message. The region no
  // longer commits to the byte-stable system-prompt section list:
  // emitting it as a self-superseding user message after retained history
  // keeps the provider KV prefix cache read on the core alive across turns.
  ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    const turn = distillTurn(payload.messages)
    if (turn !== undefined) {
      const lume = ctx.promptLume as unknown as { primeTurn(t: TurnSurface): void }
      lume.primeTurn(turn)
    }
    // Drain the region the just-completed assembly staged. `agents` is an
    // optional dependency (browser/test host mounts may lack the service); a
    // region staged without an agent session is left for the next pre-step.
    const agents = ctx.get('agents') as { currentInitiator?: () => { session?: Session } } | undefined
    const session = agents?.currentInitiator?.()?.session
    if (session !== undefined) {
      const lume = ctx.promptLume as unknown as { emitRegion(s: Session): unknown }
      lume.emitRegion(session)
    }
    return next()
  })
}

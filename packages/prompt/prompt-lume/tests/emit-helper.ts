import type { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@atlasai/atsh-session'

/**
 * One stable in-memory session per test Context. The region emission path
 * supersedes its OWN prior wall on the SAME session (surfaceOp replace spans a
 * node that must exist on that session), so a test that drains multiple turns
 * must reuse one Session object rather than recreating one per call.
 */
const regionSessions = new WeakMap<Context, Session>()
let regionSessionCounter = 0

/** The stable region-emission session for a test Context (created on first use). */
export function stableRegionSession(ctx: Context): Session {
  let session = regionSessions.get(ctx)
  if (session === undefined) {
    // Unique name per context so two mounts never share a replace span target.
    regionSessionCounter += 1
    session = Session.create(SessionId(`gaf247-emit-${regionSessionCounter}`))
    regionSessions.set(ctx, session)
  }
  return session
}

/**
 * Flatten a user-message content payload (text block array or plain string).
 */
export function messageTextOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => typeof part === 'object' && part !== null && 'text' in part
        ? String((part as { text: unknown }).text)
        : '')
      .join('')
  }
  return ''
}

/**
 * Drain a prompt-lume service's staged region through the real emission path
 * and return its flattened text ('' when nothing was staged). the prior workstream moved
 * the region out of the system-prompt section list into a tail user/message,
 * so tests that used to read `assembly.sections` now read the emission.
 */
export function emittedRegionText(ctx: Context): string {
  const lume = ctx.promptLume as unknown as { emitRegion(s: Session): { data: { content: unknown } } | undefined }
  const emitted = lume.emitRegion(stableRegionSession(ctx))
  if (emitted === undefined) return ''
  return messageTextOf(emitted.data.content)
}

/** True when the service has staged (un-emitted) a region for the current turn. */
export function lumeHasPendingRegion(ctx: Context): boolean {
  const lume = ctx.promptLume as unknown as { hasPendingRegion(): boolean }
  return lume.hasPendingRegion()
}

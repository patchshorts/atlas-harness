// Channel-based instruction marking (Fix 12/6 lane separation). Pure derived
// pass — no I/O, no this: markChannels returns a NEW array and never mutates
// the input messages (golden rule). Presentation labels are derived values;
// the session log never sees them.

import type { Channel, ChanneledMessage } from './types.ts'

/** Lane authority: system instructions outrank everything; tool output is least trusted. */
export const AUTHORITY: Record<Channel, number> = {
  system: 3,
  user: 2,
  assistant: 2,
  tool: 1,
}

/**
 * Map a message role to its trust channel.
 *
 * @param role - the message role string ('system', 'tool', 'assistant', ...).
 * @returns the channel; anything unrecognized is treated as user content.
 */
export function channelOf(role: string): Channel {
  switch (role) {
    case 'system':
      return 'system'
    case 'tool':
      return 'tool'
    case 'assistant':
      return 'assistant'
    default:
      return 'user'
  }
}

/**
 * Derive channel + authority for every message in a list.
 *
 * @param messages - read-only message list (role + content per entry).
 * @returns a NEW array of channeled messages; the input array and every
 *   input object are never mutated (golden rule).
 */
export function markChannels(messages: ReadonlyArray<{ role: string; content: string }>): ChanneledMessage[] {
  return messages.map((msg) => {
    const channel = channelOf(msg.role)
    return {
      role: msg.role,
      content: msg.content,
      channel,
      authority: AUTHORITY[channel],
    }
  })
}

const LANE_LABELS: Record<Channel, string> = {
  system: 'LANE 1 — SYSTEM INSTRUCTION',
  user: 'LANE 2 — USER/TASK',
  tool: 'LANE 3 — UNTRUSTED TOOL OUTPUT',
  assistant: 'LANE 2 — MODEL',
}

/**
 * The presentation label for a channel.
 *
 * @param channel - the trust channel.
 * @returns the lane label (presentation only — the log never sees it).
 */
export function laneLabel(channel: Channel): string {
  return LANE_LABELS[channel]
}

/**
 * Whether a channeled message is untrusted tool output.
 *
 * @param msg - the channeled message.
 * @returns true when the message came from the tool channel.
 */
export function isToolChannel(msg: ChanneledMessage): boolean {
  return msg.channel === 'tool'
}

/**
 * Whether channel a strictly outranks channel b.
 *
 * @param a - the first channel.
 * @param b - the second channel.
 * @returns true when authority(a) > authority(b).
 */
export function higherAuthority(a: Channel, b: Channel): boolean {
  return AUTHORITY[a] > AUTHORITY[b]
}

/**
 * PromptArmor-style neutralizer for tool-result content (defense in depth;
 * the allowlist gate is the load-bearing boundary). A pure function that
 * neutralizes directive-like fragments — imperative instructions the model is
 * being told to act on, which are token-indistinguishable from truth in the
 * in-band attack class — while leaving benign content intact. Neutralization
 * wraps the fragment in square brackets and tags it as untrusted data rather
 * than deleting it, so the model still sees the information exists but no
 * longer reads an executable directive.
 *
 * The module is PURE and deterministic: same input, same output, no wall
 * clock, no state, no I/O. It is a defense-in-depth pass on the
 * `tools/post-execute` content before it reaches model context — it never
 * rewrites history or projections (golden rule intact).
 *
 * @module @atlasai/atsh-tool-allowlist/sanitize
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@atlasai/atsh-llm'
import type { PostToolDecision, ToolExecution } from '@atlasai/atsh-tools'

/**
 * Directive-like imperative openings that indicate an instruction being
 * smuggled as content. Matched case-insensitively at the start of a text
 * fragment or after a line boundary. Each is a plain imperative verb phrase
 * ("ignore", "forget", "pretend", "from now on", ...) that a benign tool
 * result would not lead with.
 */
const DIRECTIVE_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget)\b.*/i,
  /\b(from now on|as an ai|you are now|your new instructions?|override)\b.*/i,
  /\b(do not|do n't|never|always)\s+(tell|follow|obey|read|consider)\b.*/i,
  /\b(pretend|imagine|act as|behave as)\b.*/i,
  /\b(system prompt|secret|hidden instruction|reveal)\b.*/i,
]

/**
 * Neutralize a single text block's directive-like fragments. Benign content
 * passes through unchanged; a fragment that matches a directive pattern is
 * wrapped in `[untrusted data: ...]` so it reads as data, not as an order.
 *
 * @param text - the raw tool-result text.
 * @returns the neutralized text with directive fragments bracketed.
 */
export function neutralizeText(text: string): string {
  if (!text) return text
  let out = text
  for (const pattern of DIRECTIVE_PATTERNS) {
    out = out.replace(pattern, match => `[untrusted data: ${match}]`)
  }
  return out
}

/**
 * Neutralize a content block array: text blocks get their directive-like
 * fragments bracketed; all other block types (reasoning, image, tool-call,
 * tool-result) pass through unchanged.
 *
 * @param content - the content blocks from a tool result.
 * @returns a new array with directive-like text fragments neutralized.
 */
export function neutralizeContent(content: ReadonlyArray<ContentBlock>): ContentBlock[] {
  return content.map((block): ContentBlock => {
    if (block.type === 'text') {
      return { ...block, text: neutralizeText(block.text) }
    }
    return block
  })
}

/**
 * Cordis companion plugin name.
 */
export const sanitizerName = 'tool-allowlist-sanitizer'

/** The tool registry service the sanitizer wraps (`tools/post-execute`). */
export const sanitizerInject = ['tools']

/**
 * Register the post-execute sanitizer wrapper. When enabled, it neutralizes
 * directive-like fragments in successful tool-result text before it reaches
 * model context. It observes the cycle as an append-only effect — it shapes
 * what the model sees, never the durable log.
 *
 * @param ctx - the Cordis context.
 * @param opts - enable switch (default true) — keep opt-in out of shipped defaults.
 */
export function applySanitizer(
  ctx: Context,
  opts: { enabled?: boolean } = {},
): void {
  const enabled = opts.enabled ?? true
  if (!enabled) return
  ctx.on('tools/post-execute', async (_exec: ToolExecution, result, next): Promise<PostToolDecision> => {
    if (!result.isError && result.content.length > 0) {
      const neutralized = neutralizeContent(result.content)
      if (JSON.stringify(neutralized) !== JSON.stringify(result.content)) {
        return { kind: 'accept', content: neutralized }
      }
    }
    return next()
  })
}

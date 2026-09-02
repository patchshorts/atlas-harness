/**
 * Atlas 43-skill thesis-relevant corpus provider.
 *
 * @module @atlasai/atsh-skill-corpus
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { FileSystemSkillProvider } from '@atlasai/atsh-skill-filesystem'

/** Absolute path to the shipped corpus directory (package-local, resolved at module load). */
export const CORPUS_DIR = fileURLToPath(new URL('../corpus/', import.meta.url))

const PROVIDER_NAME = 'atlas-corpus'

/** Cordis plugin name. */
export const name = 'skill-corpus'
/** Service required by the bundled provider. */
export const inject = ['skills']

/**
 * Register the Atlas sanitized corpus as a bundled skill root on `ctx.skills`.
 *
 * The corpus is a pure content add (additive-inventory.md row 22): 43 thesis-relevant
 * SKILL.md files from agentic/atlas, flattened to the harness's one-level
 * `corpus/<skill>/SKILL.md` layout. The existing `skill-filesystem` provider is
 * pointed at it via `customSkillDirs`; no existing package source is touched.
 *
 * @param ctx - Cordis context carrying the skill registry.
 */
export function apply(ctx: Context): void {
  let provider!: FileSystemSkillProvider
  ctx.skills.registerProvider((control) => {
    provider = new FileSystemSkillProvider(ctx, control, {
      providerName: PROVIDER_NAME,
      includeDefaultRoots: false,
      customSkillDirs: [CORPUS_DIR],
      watch: false,
    })
    return provider
  })
  ctx.effect(function* () {
    yield async () => { await provider.dispose() }
  }, 'skill-corpus provider')
}

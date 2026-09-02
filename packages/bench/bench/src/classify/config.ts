/**
 * Default classifier configuration + manifest loading.
 *
 * The lexicon is frozen in bench-manifest.json before any session runs
 * (spec §2.2, pre-registration rule). The T5 runner feeds the frozen row
 * through {@link loadConfigFromManifest}; the defaults below mirror the
 * frozen row verbatim so the classifier is correct even when invoked without
 * a manifest (unit tests, ad-hoc audits).
 *
 * @module @atlasai/atsh-bench/classify/config
 */

import { readFileSync } from 'node:fs'
import type { ClassifierConfig } from './types.ts'

/** Correction lexicon, frozen 2026-08-16 in bench-manifest.json (spec §2.2 verbatim). */
export const FROZEN_LEXICON: readonly string[] = [
  'wrong',
  'incorrect',
  'mistake',
  'sorry',
  'my error',
  'that failed',
  'redo',
  'revert',
  'undo',
  'roll back',
  'retry',
  'fix it',
  'fix this',
  'do not',
  'dont',
  'stop',
  'no',
  'cancel',
  'actually',
  'instead',
  'not what',
  'use ... instead',
  'you missed',
  'broken',
  'does not work',
]

/** Tool names whose call writes file content — C2 payload family (spec §2.1). */
export const DEFAULT_FS_WRITE_FAMILY: readonly string[] = [
  'tool:write',
  'write',
  'write_file',
  'fs.write_file',
]

/** Tool names whose call edits file content — C2 payload family (spec §2.1). */
export const DEFAULT_FS_EDIT_FAMILY: readonly string[] = [
  'tool:edit',
  'edit',
  'edit_file',
  'fs.edit_file',
  'str_replace_editor',
]

/** Default configuration; mirrors the frozen manifest values. */
export const DEFAULT_CONFIG: ClassifierConfig = {
  lexicon: [...FROZEN_LEXICON],
  c1RetryWindow: 4,
  c5AssistantWindow: 6,
  userMessageMaxChars: 200,
  fsWriteFamily: [...DEFAULT_FS_WRITE_FAMILY],
  fsEditFamily: [...DEFAULT_FS_EDIT_FAMILY],
}

/**
 * Read the frozen C3/C5 lexicon from a bench-manifest.json (spec §2.2).
 *
 * @param manifestPath - path to bench-manifest.json.
 * @returns the `lexicon.c3_c5_tokens` array.
 * @throws when the file is unreadable or the lexicon row is missing or unfrozen.
 */
export function loadManifestLexicon(manifestPath: string): string[] {
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  } catch (error) {
    throw new Error(`bench-classify: cannot read manifest ${manifestPath}: ${(error as Error).message}`)
  }
  const lexicon = manifest.lexicon
  if (lexicon === null || typeof lexicon !== 'object') {
    throw new Error(`bench-classify: manifest ${manifestPath} has no lexicon row`)
  }
  const row = lexicon as Record<string, unknown>
  const tokens = row.c3_c5_tokens
  if (!Array.isArray(tokens) || tokens.some(token => typeof token !== 'string')) {
    throw new Error(`bench-classify: manifest ${manifestPath} lexicon.c3_c5_tokens must be a string array`)
  }
  if (row.frozen !== true) {
    throw new Error(`bench-classify: manifest ${manifestPath} lexicon is not frozen (pre-registration rule, spec §2.2)`)
  }
  return tokens as string[]
}

/**
 * Build a classifier config from a bench-manifest.json, overriding any
 * non-lexicon defaults with the caller's values.
 *
 * @param manifestPath - path to bench-manifest.json.
 * @param overrides - partial config; the manifest supplies the lexicon, overrides supply windows/families.
 */
export function loadConfigFromManifest(manifestPath: string, overrides: Partial<ClassifierConfig> = {}): ClassifierConfig {
  const { lexicon: _lexicon, ...rest } = overrides
  return {
    ...DEFAULT_CONFIG,
    ...rest,
    lexicon: loadManifestLexicon(manifestPath),
  }
}

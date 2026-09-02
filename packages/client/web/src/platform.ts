/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 * @module @atlasai/atsh-client-web/src/platform
 */

/** The module specifiers the shell shares into the frozen module table. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@atlasai/atsh-client-ui-slots',
  '@atlasai/atsh-client-web-react',
  '@atlasai/atsh-client-ui-primitives',
  '@atlasai/atsh-client-ui-attachment',
  '@atlasai/atsh-client-schema-form',
] as const

/** One platform module specifier (a seed-table key). */
export type PlatformModule = (typeof PLATFORM_MODULES)[number]

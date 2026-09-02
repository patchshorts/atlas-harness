# skill-corpus — Atlas 22-skill corpus

English | [中文](README.zh.md)

This package ships the Atlas framework's skill corpus (22 SKILL.md files,
authored by Atlas AI) as a bundled skill root for the Atlas Harness.

| Package | Role | ctx key |
|---|---|---|
| [`skill-corpus/`](skill-corpus/) | Ships 22 SKILL.md files; registers on `ctx.skills` | registers on `ctx.skills` |

## Model Experience

Mounting this package adds 22 skills to the skill catalog: research, GitHub
workflow, knowledge (wiki, Polymarket, JSON Canvas, Obsidian), and core
engineering-practice skills.

Skills are addressable by their kebab-case frontmatter `name` (e.g.
`github-code-review`, `research-paper-writing`, `obsidian`). Bodies load through the standard
`ctx.skills` loader; `tool-skill` and `skill-badge` consume them as-is.

## Integration surface

- **Layout:** `corpus/<skill>/SKILL.md` — one level, matching the harness
  skill-filesystem scanner contract.
- **Registration:** the plugin registers the existing
  `FileSystemSkillProvider` (from `@atlasai/atsh-skill-filesystem`) pointed
  at `corpus/` via `customSkillDirs`, with default roots disabled and watching
  off. No existing package source is modified.
- **Provider name:** `atlas-corpus` (distinct from the stock `filesystem`
  provider).

## Provenance

- Authored by Atlas AI (Christopher Shaun Godwin) from public engineering
  skill patterns. Sanitization gate `tests/test_sanitization.py` passed; zero
  personal names, emails, phones, financials, secrets, API keys, URLs, IPs,
  hostnames, ports, project IDs, or personal-namespace repo paths.
- Count: 22 SKILL.md files on disk, all canonical (unique frontmatter names).

## Known Limitations and Deferred Work

- The 22-skill corpus is the current Atlas skill set. Expand it
  deliberately when the harness needs new capabilities.
- The corpus is static content. Refresh policy: extend it deliberately when
  needed; re-run the count and scanner tests after any refresh.
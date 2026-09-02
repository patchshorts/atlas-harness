# Agent Skills

Repository development-workflow skills for AI coding agents, in the format used
by Claude Code (`.claude/skills`) and compatible agent CLIs. Each skill is a
`SKILL.md` file with frontmatter (name, description) plus optional supporting
scripts, references, and agent-definition files.

This set is carried over from upstream DeepSeek Harness (pinned at
`47f943859b`, v0.1.0-rc.5, MIT — see [UPSTREAM.md](../../UPSTREAM.md)) and kept
as part of the fork's development workflow. The `dsh-` prefix is upstream
lineage naming, not branding of this repository.

## The skills

| Skill | Purpose |
|---|---|
| [dsh-pre-push-checks](dsh-pre-push-checks/SKILL.md) | Select the smallest checks that cover an outgoing diff before pushing |
| [dsh-code-review](dsh-code-review/SKILL.md) | Orient a PR review to this codebase's standards and gates |
| [dsh-merging-stacked-prs](dsh-merging-stacked-prs/SKILL.md) | Mechanics for merging stacked pull requests |
| [dsh-doc-standards](dsh-doc-standards/SKILL.md) | Documentation authoring standards for this repo |
| [dsh-doc-site-sync](dsh-doc-site-sync/SKILL.md) | Keep the VitePress site projection in sync with docs/ sources |
| [dsh-translate-docs](dsh-translate-docs/SKILL.md) | Produce and maintain the bilingual (.zh.md) doc pairs |
| [dsh-prose-standard](dsh-prose-standard/SKILL.md) | Prose style decisions for comments and docs |
| [dsh-archive-agent-notes](dsh-archive-agent-notes/SKILL.md) | Seal design notes into the frozen archive (see .agents/notes/) |
| [dsh-find-simplifications](dsh-find-simplifications/SKILL.md) | Find candidate simplifications in the codebase |
| [dsh-trim-cot-leakage](dsh-trim-cot-leakage/SKILL.md) | Keep chain-of-thought artifacts out of committed docs |
| [record-browser-gif](record-browser-gif/SKILL.md) | Record browser-session GIFs for docs |

`dsh-pre-push-checks` is referenced from [AGENTS.md](../../AGENTS.md) ("Run
relevant checks locally"); the doc skills are wired into the repository's
doc-sync gates. The companion tree [`.agents/notes/`](../notes/README.md) holds
the archived design-decision notes these workflows produce and consume.

## Portability

Skills are plain markdown — copy any of them into your own `.claude/skills/`
or `.agents/skills/` directory and adapt branch/push conventions to your
workflow. Nothing here requires credentials or external services.

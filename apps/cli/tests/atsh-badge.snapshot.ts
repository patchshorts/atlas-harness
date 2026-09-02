import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@atlasai/atsh-loader-smoke'
const binScript = fileURLToPath(new URL('./fixtures/atsh-badge/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/atsh-badge/cordis.yml', import.meta.url))
const defaultConfigPath = fileURLToPath(new URL('./fixtures/atsh-badge/default.cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const badgeAssetsPath = fileURLToPath(new URL('../../../packages/skill/skill-badge/assets/', import.meta.url))

describe('atsh badge assembled snapshot', () => {
  it('advertises and loads the opt-in bundled skill through the shipped app', async () => {
    const disabled = await runLoaderSmoke({
      label: 'disabled atsh badge skill snapshot',
      tempDirPrefix: 'headless-snapshot-atsh-badge-disabled-',
      binScript,
      libBinScript: binScript,
      configPath: defaultConfigPath,
      tsconfigPath,
    })
    const enabled = await runLoaderSmoke({
      label: 'atsh badge skill snapshot',
      tempDirPrefix: 'headless-snapshot-atsh-badge-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
    })
    const disabledSnapshot = JSON.parse(disabled.stdout) as unknown
    const enabledSnapshot = JSON.parse(
      enabled.stdout.replaceAll(badgeAssetsPath, '{{badgeAssetsPath}}'),
    ) as unknown

    expect(disabled.stderr).toBe('')
    expect(enabled.stderr).toBe('')
    expect(disabledSnapshot).toMatchInlineSnapshot(`
      {
        "catalog": [
          {
            "text": "<system-reminder>
      A skill is a reusable set of task-specific instructions. The following skills are available in this session:

      <available_skills>
      - \`arxiv\`: Search arXiv papers by keyword, author, category, or ID.
      - \`codebase-inspection\`: Inspect codebases w/ pygount: LOC, languages, ratios.
      - \`github-auth\`: GitHub auth setup: HTTPS tokens, SSH keys, gh CLI login.
      - \`github-code-review\`: Review PRs: diffs, inline comments via gh or REST.
      - \`github-issues\`: Create, triage, label, assign GitHub issues via gh or REST.
      - \`github-pr-workflow\`: GitHub PR lifecycle: branch, commit, open, CI, merge.
      - \`github-repo-management\`: Clone/create/fork repos; manage remotes, releases.
      - \`json-canvas\`: Create and edit JSON Canvas (.canvas) files with nodes, edges, groups, and connections for Obsidian canvases, mind maps, flowcharts, and project boards. Ported from kepano/obsidian-skills.
      - \`llm-wiki\`: Karpathy's LLM Wiki v3: knowledge base + graph analysis + agent guidelines + internal agent memory.
      - \`obsidian\`: Read, search, create, and edit notes in the Obsidian vault using Obsidian Flavored Markdown (OFM) with wikilinks, embeds, callouts, properties, tags, and block IDs. Enhanced from kepano/obsidian-skills.
      - \`obsidian-bases\`: Create and edit Obsidian Bases (.base) files with views, filters, formulas, and summaries. Ported from kepano/obsidian-skills.
      - \`plan\`: Plan mode: write markdown plan to .Atlas/plans/, no exec.
      - \`polymarket\`: Query Polymarket: markets, prices, orderbooks, history.
      - \`requesting-code-review\`: Pre-commit review: security scan, quality gates, auto-fix.
      - \`research-paper-writing\`: Write ML papers for NeurIPS/ICML/ICLR: design→submit.
      - \`software-architecture-analysis\`: Write comprehensive software architecture analysis documents — system design, component inventory, data flow, auth, queue, database schema, deployment. The architectural blueprint that precedes implementation planning.
      - \`spike\`: Throwaway experiments to validate an idea before build.
      - \`strategy-building\`: Roger Martin's 'A Plan Is Not a Strategy' framework — build real strategy (integrative choices to win) instead of comfortable planning (lists of activities). Based on his HBR talk and Strategy Cascade.
      - \`systematic-debugging\`: 4-phase root cause debugging: understand bugs before fixing.
      - \`test-driven-development\`: TDD: enforce RED-GREEN-REFACTOR, tests before code.
      - \`writing-plans\`: Write implementation plans: bite-sized tasks, paths, code.
      - \`xurl\`: X/Twitter via xurl CLI: post, search, DM, media, v2 API.
      </available_skills>

      If the user names a skill, or the task clearly matches a skill's description, call the \`skill\` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.
      A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the \`skill\` tool again for that skill.
      </system-reminder>",
            "type": "text",
          },
        ],
        "result": {
          "content": [
            {
              "text": "Error: skill "atsh-badge" is unknown or no longer available",
              "type": "text",
            },
          ],
          "error": {
            "message": "skill "atsh-badge" is unknown or no longer available",
          },
          "isError": true,
        },
        "summary": null,
      }
    `)
    expect(enabledSnapshot).toMatchInlineSnapshot(`
      {
        "catalog": [
          {
            "text": "<system-reminder>
      A skill is a reusable set of task-specific instructions. The following skills are available in this session:

      <available_skills>
      - \`arxiv\`: Search arXiv papers by keyword, author, category, or ID.
      - \`atsh-badge\`: Add the official “powered by atsh” badge to documents, pull requests, merge requests, and other content produced with DeepSeek Harness. Use whenever creating a pull request or merge request. Also use when the user asks for a atsh badge, powered-by-dsh attribution, or a reusable atsh badge asset or snippet.
      - \`codebase-inspection\`: Inspect codebases w/ pygount: LOC, languages, ratios.
      - \`github-auth\`: GitHub auth setup: HTTPS tokens, SSH keys, gh CLI login.
      - \`github-code-review\`: Review PRs: diffs, inline comments via gh or REST.
      - \`github-issues\`: Create, triage, label, assign GitHub issues via gh or REST.
      - \`github-pr-workflow\`: GitHub PR lifecycle: branch, commit, open, CI, merge.
      - \`github-repo-management\`: Clone/create/fork repos; manage remotes, releases.
      - \`json-canvas\`: Create and edit JSON Canvas (.canvas) files with nodes, edges, groups, and connections for Obsidian canvases, mind maps, flowcharts, and project boards. Ported from kepano/obsidian-skills.
      - \`llm-wiki\`: Karpathy's LLM Wiki v3: knowledge base + graph analysis + agent guidelines + internal agent memory.
      - \`obsidian\`: Read, search, create, and edit notes in the Obsidian vault using Obsidian Flavored Markdown (OFM) with wikilinks, embeds, callouts, properties, tags, and block IDs. Enhanced from kepano/obsidian-skills.
      - \`obsidian-bases\`: Create and edit Obsidian Bases (.base) files with views, filters, formulas, and summaries. Ported from kepano/obsidian-skills.
      - \`plan\`: Plan mode: write markdown plan to .Atlas/plans/, no exec.
      - \`polymarket\`: Query Polymarket: markets, prices, orderbooks, history.
      - \`requesting-code-review\`: Pre-commit review: security scan, quality gates, auto-fix.
      - \`research-paper-writing\`: Write ML papers for NeurIPS/ICML/ICLR: design→submit.
      - \`software-architecture-analysis\`: Write comprehensive software architecture analysis documents — system design, component inventory, data flow, auth, queue, database schema, deployment. The architectural blueprint that precedes implementation planning.
      - \`spike\`: Throwaway experiments to validate an idea before build.
      - \`strategy-building\`: Roger Martin's 'A Plan Is Not a Strategy' framework — build real strategy (integrative choices to win) instead of comfortable planning (lists of activities). Based on his HBR talk and Strategy Cascade.
      - \`systematic-debugging\`: 4-phase root cause debugging: understand bugs before fixing.
      - \`test-driven-development\`: TDD: enforce RED-GREEN-REFACTOR, tests before code.
      - \`writing-plans\`: Write implementation plans: bite-sized tasks, paths, code.
      - \`xurl\`: X/Twitter via xurl CLI: post, search, DM, media, v2 API.
      </available_skills>

      If the user names a skill, or the task clearly matches a skill's description, call the \`skill\` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.
      A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the \`skill\` tool again for that skill.
      </system-reminder>",
            "type": "text",
          },
        ],
        "result": {
          "content": [
            {
              "text": "<skill_content name="atsh-badge">
      <skill_resources>
      Base directory for this skill: {{badgeAssetsPath}}
      Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.
      </skill_resources>

      <skill_instructions>
      # atsh Badge

      Add the official “powered by atsh” badge without recreating or restyling it.

      ## Assets

      - Local PNG: [\`atsh-badge.png\`](atsh-badge.png), 726×120 source image; render at 121×20
      - Shields.io image URL: \`https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white\`
      - Project URL: \`https://github.com/deepseek-ai/deepseek-harness\`

      ## Markdown

      Use this linked badge in Markdown:

      \`\`\`markdown
      [![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
      \`\`\`

      If attribution should not be linked, use:

      \`\`\`markdown
      ![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)
      \`\`\`

      ## Usage rules

      - For GitHub or GitLab Markdown, use the Shields.io URL and link it to the project URL unless the user asks for an unlinked image.
      - For Feishu and other systems that import remote images unreliably, upload \`atsh-badge.png\` from this skill directory instead of generating another badge.
      - Preserve the badge's 121×20 dimensions and aspect ratio.
      - Place the badge at the end of the attributed document or section unless the user specifies another position.
      - Do not substitute another color, logo, label, or project URL.

      </skill_instructions>
      </skill_content>",
              "type": "text",
            },
          ],
          "isError": false,
          "value": {
            "content": "# atsh Badge

      Add the official “powered by atsh” badge without recreating or restyling it.

      ## Assets

      - Local PNG: [\`atsh-badge.png\`](atsh-badge.png), 726×120 source image; render at 121×20
      - Shields.io image URL: \`https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white\`
      - Project URL: \`https://github.com/deepseek-ai/deepseek-harness\`

      ## Markdown

      Use this linked badge in Markdown:

      \`\`\`markdown
      [![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
      \`\`\`

      If attribution should not be linked, use:

      \`\`\`markdown
      ![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)
      \`\`\`

      ## Usage rules

      - For GitHub or GitLab Markdown, use the Shields.io URL and link it to the project URL unless the user asks for an unlinked image.
      - For Feishu and other systems that import remote images unreliably, upload \`atsh-badge.png\` from this skill directory instead of generating another badge.
      - Preserve the badge's 121×20 dimensions and aspect ratio.
      - Place the badge at the end of the attributed document or section unless the user specifies another position.
      - Do not substitute another color, logo, label, or project URL.
      ",
            "name": "atsh-badge",
            "provider": "atsh-badge",
            "resourceBase": {
              "kind": "directory",
              "path": "{{badgeAssetsPath}}",
            },
          },
        },
        "summary": {
          "description": "Add the official “powered by atsh” badge to documents, pull requests, merge requests, and other content produced with DeepSeek Harness. Use whenever creating a pull request or merge request. Also use when the user asks for a atsh badge, powered-by-dsh attribution, or a reusable atsh badge asset or snippet.",
          "invocation": {
            "modelInvocable": true,
            "userInvocable": true,
          },
          "name": "atsh-badge",
          "provider": "atsh-badge",
          "resourceBase": {
            "kind": "directory",
            "path": "{{badgeAssetsPath}}",
          },
          "source": "bundled",
        },
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)
})

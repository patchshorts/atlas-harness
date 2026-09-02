---
name: plan
description: "Plan mode: write markdown plan to .Atlas/plans/, no exec."
version: 1.0.0
author: Atlas AI
license: MIT
---

# Plan Mode

Use this skill when the user wants a plan instead of execution.

## Before writing ANY plan

**Check for existing plans first.** Search `scrum/planning/` and `.Atlas/plans/` before creating a new one. If an existing plan covers the territory, read it and present it — don't write a duplicate. User frustration signal: "why the hell did you write a new plan? I said bring up the existing plan." Only create new plans for genuinely new territory not covered by any existing document.

## Core behavior

For this turn, you are planning only.

- Do not implement code.
- Do not edit project files except the plan markdown file.
- Do not run mutating terminal commands, commit, push, or perform external actions.
- You may inspect the repo or other context with read-only commands/tools when needed.
- Your deliverable is a markdown plan saved inside the active workspace under `.Atlas/plans/`.

## Output requirements

Write a markdown plan that is concrete and actionable.

Include, when relevant:
- Goal
- Current context / assumptions
- Proposed approach
- Step-by-step plan
- Files likely to change
- Tests / validation
- Risks, tradeoffs, and open questions

If the task is code-related, include exact file paths, likely test targets, and verification steps.

## Save location

Save the plan with `write_file` under:
- `.Atlas/plans/YYYY-MM-DD_HHMMSS-<slug>.md`

Treat that as relative to the active working directory / backend workspace. Atlas file tools are backend-aware, so using this relative path keeps the plan with the workspace on local, docker, ssh, modal, and daytona backends.

If the runtime provides a specific target path, use that exact path.
If not, create a sensible timestamped filename yourself under `.Atlas/plans/`.

## Interaction style

- If the request is clear enough, write the plan directly.
- If no explicit instruction accompanies `/plan`, infer the task from the current conversation context.
- If it is genuinely underspecified, ask a brief clarifying question instead of guessing.
- After saving the plan, reply briefly with what you planned and the saved path.

## Critical: "bring up the plan" ≠ new plan

When the user says "bring up the plan", "pull up the plan", "show me the plan", or references an existing plan by name/path, do NOT write a new plan. Read the existing file and display it inline. Only write a new plan when the user explicitly asks to create, write, or draft one.

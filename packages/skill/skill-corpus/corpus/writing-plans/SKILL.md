---
name: writing-plans
description: "Write implementation plans: bite-sized tasks, paths, code."
version: 1.1.0
author: Atlas AI
license: MIT
---

# Writing Implementation Plans

## Overview

Write comprehensive implementation plans assuming the implementer has zero context for the codebase and questionable taste. Document everything they need: which files to touch, complete code, testing commands, docs to check, how to verify. Give them bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume the implementer is a skilled developer but knows almost nothing about the toolset or problem domain. Assume they don't know good test design very well.

**Core principle:** A good plan makes implementation obvious. If someone has to guess, the plan is incomplete.

## When to Use

**Always use before:**
- Implementing multi-step features
- Breaking down complex requirements
- Delegating to subagents via subagent-driven-development

**Don't skip when:**
- Feature seems simple (assumptions cause bugs)
- You plan to implement it yourself (future you needs guidance)
- Working alone (documentation matters)

## Bite-Sized Task Granularity

**Each task = 2-5 minutes of focused work.**

Every step is one action:
- "Write the failing test" — step
- "Run it to make sure it fails" — step
- "Implement the minimal code to make the test pass" — step
- "Run the tests and make sure they pass" — step
- "Commit" — step

**Too big:**
```markdown
### Task 1: Build authentication system
[50 lines of code across 5 files]
```

**Right size:**
```markdown
### Task 1: Create User model with email field
[10 lines, 1 file]

### Task 2: Add password hash field to User
[8 lines, 1 file]

### Task 3: Create password hashing utility
[15 lines, 1 file]
```

## Plan Document Structure

### Header (Required)

Every plan MUST start with:

```markdown
# [Feature Name] Implementation Plan

> **For Atlas:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

### Task Structure

Each task follows this format:

````markdown
### Task N: [Descriptive Name]

**Objective:** What this task accomplishes (one sentence)

**Files:**
- Create: `exact/path/to/new_file.py`
- Modify: `exact/path/to/existing.py:45-67` (line numbers if known)
- Test: `tests/path/to/test_file.py`

**Step 1: Write failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

**Step 2: Run test to verify failure**

Run: `pytest tests/path/test.py::test_specific_behavior -v`
Expected: FAIL — "function not defined"

**Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

**Step 4: Run test to verify pass**

Run: `pytest tests/path/test.py::test_specific_behavior -v`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

## Writing Process

### Step 1: Understand Requirements

Read and understand:
- Feature requirements
- Design documents or user description
- Acceptance criteria
- Constraints

### Step 2: Explore the Codebase

Use Atlas tools to understand the project:

```python
# Understand project structure
search_files("*.py", target="files", path="src/")

# Look at similar features
search_files("similar_pattern", path="src/", file_glob="*.py")

# Check existing tests
search_files("*.py", target="files", path="tests/")

# Read key files
read_file("src/app.py")
```

### Step 3: Design Approach

Decide:
- Architecture pattern
- File organization
- Dependencies needed
- Testing strategy

### Step 4: Write Tasks

Create tasks in order:
1. Setup/infrastructure
2. Core functionality (TDD for each)
3. Edge cases
4. Integration
5. Cleanup/documentation

### Step 5: Add Complete Details

For each task, include:
- **Exact file paths** (not "the config file" but `src/config/settings.py`)
- **Complete code examples** (not "add validation" but the actual code)
- **Exact commands** with expected output
- **Verification steps** that prove the task works

### Step 6: Review the Plan

Check:
- [ ] Tasks are sequential and logical
- [ ] Each task is bite-sized (2-5 min)
- [ ] File paths are exact
- [ ] Code examples are complete (copy-pasteable)
- [ ] Commands are exact with expected output
- [ ] No missing context
- [ ] DRY, YAGNI, TDD principles applied

### Step 7: Save the Plan

```bash
mkdir -p docs/plans
# Save plan to docs/plans/YYYY-MM-DD-feature-name.md
git add docs/plans/
git commit -m "docs: add implementation plan for [feature]"
```

### ⚠️ Boundary Rule: Write the Spec, Stop There

Your job when writing a plan or story is to produce the **specification** — not to start executing it. Once the plan/story is saved:

- **Do NOT** begin implementing the work yourself
- **Do NOT** clone repos, write code, or run experiments that the plan describes
- **Do NOT** pre-validate assumptions by prototyping
- **DO** save the plan, update the scrum board if applicable, and hand off to the execution pipeline (sub-agents, cron dispatcher, or the user)

The user's correction was explicit: *"You are to write stories only so that the sub agents do the downloading."* If the user says "write a story" or "write a plan," do exactly that — produce the document and stop. Resist the temptation to start executing because you can see where it's going. That's the sub-agent's job.

This is distinct from executing *after* the user asks for it. If the user follows up with "now do it" or dispatches the story, then execute. Until then, the deliverable is the document.

### Batch Decomposition in Plans

When a plan or story involves processing a large set of similar items (e.g., reformatting all 90 entity files, migrating 30 config files), the plan MUST include a **decomposition step** as the first task:

```markdown
### Task 0: Decompose the work into sub-stories

**Before processing any files**, enumerate the full target list, split into batches
of at most 5 files each, and write a sub-story to `scrum/todo/` per batch using the
Story Decomposition format documented in `scrum-board-management` skill.

Only process the first batch (5 files) in this tick. Remaining batches are picked
up by subsequent cron ticks.
```

This prevents a single story from trying to process 30 files in one dispatch -- which
causes tool-limit interruptions, inconsistent formatting, and missed files.

## Principles

### DRY (Don't Repeat Yourself)

**Bad:** Copy-paste validation in 3 places
**Good:** Extract validation function, use everywhere

### YAGNI (You Aren't Gonna Need It)

**Bad:** Add "flexibility" for future requirements
**Good:** Implement only what's needed now

```python
# Bad — YAGNI violation
class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email
        self.preferences = {}  # Not needed yet!
        self.metadata = {}     # Not needed yet!

# Good — YAGNI
class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email
```

### TDD (Test-Driven Development)

Every task that produces code should include the full TDD cycle:
1. Write failing test
2. Run to verify failure
3. Write minimal code
4. Run to verify pass

See `test-driven-development` skill for details.

### Frequent Commits

Commit after every task:
```bash
git add [files]
git commit -m "type: description"
```

## Common Mistakes

### Vague Tasks

**Bad:** "Add authentication"
**Good:** "Create User model with email and password_hash fields"

### Incomplete Code

**Bad:** "Step 1: Add validation function"
**Good:** "Step 1: Add validation function" followed by the complete function code

### Missing Verification

**Bad:** "Step 3: Test it works"
**Good:** "Step 3: Run `pytest tests/test_auth.py -v`, expected: 3 passed"

### Infrastructure-Order Blindness

**Bad:** Plan starts with "Set up Docker, CI/CD, Kubernetes" before the application logic

**This is the most common planning mistake.** Infrastructure (containers, runners, deploy pipelines) is *orchestration*, not *product*. Adding it before proving the core pipeline works:
- Hides bugs in app logic behind infra failures
- Wastes setup time if the core approach needs to change
- Creates a rebuild tax every time the pipeline script changes

**Good:** Plan validates the core pipeline on bare metal first — a simple Python script that reads input and writes output. Only after the `generate → assemble → publish` flow works end-to-end does the plan add orchestration (GitLab CI/CD, Docker runners, GPU passthrough).

```markdown
### ✅ Right Order
Phase 1:  Core pipeline scripts (local, proven)
Phase 2:  Feature extension (more formats, higher quality)
Phase 3:  Infrastructure (CI/CD, containers, runners)
Phase 4:  Production hardening (trend detection, caching, monitoring)
```

**Exception:** If the core pipeline *cannot run* without infra (e.g., it's a cloud-native service), infra comes first — but the plan should explicitly state this constraint and keep the infra scope minimal (just enough to run the core, not production-grade).

### Missing File Paths

**Bad:** "Create the model file"
**Good:** "Create: `src/models/user.py`"

### External Repo Dependency Without Clone Step

**Bad:** Story references a GitHub repo but only analyzes from README, video transcript, blog post, or third-party summary. Implements a port/framework inspired by the description rather than the actual source code.

**Good:** Story explicitly includes concrete repo-analysis steps:
```
- Clone https://github.com/org/repo to ~/code/repos/repo-name
- Source-audit every relevant file (not just README)
- Save audit findings to scrum/planning/<topic>-source-audit.md
- Build implementation based on actual source patterns, not descriptions
```

**Why it matters:** Porting, integrating, or building against a third-party tool without inspecting its actual source code produces implementations that match the *idea* of the tool rather than its actual architecture. Hook signatures, event systems, config formats, and edge cases only surface when you read real code files. A video transcript or README cannot substitute for source-level analysis.

**Applies to any story/plan that references external repos** — GitHub projects, libraries, frameworks, APIs, or any third-party code that will be consumed, ported, integrated, or adapted.

## Execution Handoff

After saving the plan, offer the execution approach:

**"Plan complete and saved. Ready to execute using subagent-driven-development — I'll dispatch a fresh subagent per task with two-stage review (spec compliance then code quality). Shall I proceed?"**

When executing, use the `subagent-driven-development` skill:
- Fresh `delegate_task` per task with full context
- Spec compliance review after each task
- Code quality review after spec passes
- Proceed only when both reviews approve

## Remember

```
Bite-sized tasks (2-5 min each)
Exact file paths
Complete code (copy-pasteable)
Exact commands with expected output
Verification steps
DRY, YAGNI, TDD
Frequent commits
```

**A good plan makes implementation obvious.**

## Reference files

- `references/external-repo-clone-pitfall.md` — Case study: three stories that analyzed external repos without ever cloning them, and the delegation-boundary lesson. Read before writing stories that reference third-party GitHub projects.
- `references/business-operational-plan.md` — Variant for non-code plans: research → gap analysis → expand loop. Use when converting videos, strategies, or research into executable operational plans (scraping, mailing, cold calling, closing — not software features). Includes the "make it bigger" response protocol.

---
name: llm-wiki
description: "Karpathy's LLM Wiki v3: knowledge base + graph analysis + agent guidelines + internal agent memory."
version: 3.2.0
author: Atlas AI
license: MIT
---

# Karpathy's LLM Wiki v3

Build a persistent, compounding knowledge base as interlinked markdown files — now with
**knowledge graph gap analysis**, **agent guidelines** (`CLAUDE.md` / `.claude/skills/`),
and **internal agent memory** (session logs → knowledge articles).

Based on [Andrej Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
and extended via the InfraNodus graph layer and Cole Medin's internal memory adaptation.

## The Compiler Analogy

Karpathy's core insight: **treat knowledge like code.**

| Code Pipeline | Knowledge Pipeline |
|---------------|-------------------|
| Source code (`.py`, `.ts`) | Raw material (articles, papers, transcripts) |
| Compiler (LLM processes code) | LLM processes raw knowledge into structured markdown |
| Executable / binary | The **Wiki** — compiled, interlinked markdown |
| Test suite | **Linting** — orphan detection, broken links, stale data |
| Runtime / execution | **Query** — agent navigates the wiki to answer questions |

**Key advantages over RAG:**
- No vector DB needed — agents navigate a structured filesystem
- Wiki persists between sessions — knowledge compounds
- Obsidian graph view gives human-visual navigation
- Plain markdown — zero infrastructure, works in any editor

## When This Skill Activates

Use this skill when the user:
- Asks to create, build, or start a wiki or knowledge base
- Asks to ingest, add, or process a source into their wiki
- Asks a question and an existing wiki is present at the configured path
- Asks to lint, audit, or health-check their wiki
- Asks about **graph analysis**, **gap analysis**, or **knowledge graph** for their wiki
- Wants to set up an **agent memory system** (session logs → knowledge articles)
- Wants **CLAUDE.md** / **AGENTS.md** guidelines for their wiki project
- References their wiki, knowledge base, or "notes" in a research context
- Asks to **reverse-engineer a prompt system** from source code into a structured wiki — this sub-pattern has a dedicated reference file and its own taxonomy of prompt-adjacent code (see [[references/prompt-engineering-codebase-analysis.md]])

## Two Variants of the Pattern

### Variant A: External Knowledge Base (Karpathy Original)
```
RAW (external sources) → WIKI (compiled) → QUERY (agent navigates index)
```
Best for: Research, learning, competitive intelligence

### Variant B: Internal Agent Memory (Cole Medin Adaptation)
```
SESSION LOGS (agent conversations) → KNOWLEDGE ARTICLES (cross-referenced) → EVOLVING MEMORY
```
Best for: Codebases, project knowledge, decision history

Ask the user which variant they want when initializing a new wiki.

## Wiki Location

**Location:** Set via `WIKI_PATH` environment variable (e.g. in `~/.Atlas/.env`).

If unset, defaults to `~/wiki`.

```bash
WIKI="${WIKI_PATH:-$HOME/wiki}"
```

The wiki is just a directory of markdown files — open it in Obsidian, VS Code, or
any editor. No database, no special tooling required.

## Full Directory Schema

```
wiki/
├── .claude/                        # Claude Code agent config
│   └── skills/                     # Reusable skill files
│       └── <skill-name>/
│           └── SKILL.md
├── CLAUDE.md                       # Agent guidelines (Claude Code)
├── AGENTS.md                       # Agent guidelines (Codex)
├── SCHEMA.md                       # Conventions, structure rules, domain config
├── index.md                        # Sectioned content catalog with one-line summaries
├── log.md                          # Chronological action log (append-only, rotated yearly)
│
├── raw/                            # Layer 1: Immutable source material
│   ├── articles/                   # Web articles, clippings
│   ├── papers/                     # PDFs, arxiv papers
│   ├── transcripts/                # Meeting notes, interviews, podcasts
│   ├── notes/                      # Personal notes, scratch
│   └── assets/                     # Images, diagrams referenced by sources
│
├── wiki/                           # Layer 2: Compiled knowledge
│   ├── entities/                   # People, orgs, products, models
│   ├── concepts/                   # Topics, ideas, themes
│   ├── comparisons/                # Side-by-side analyses
│   ├── queries/                    # Filed query results worth keeping
│   └── sources/                    # Per-source summary pages
│
├── infranodus/                     # (Optional) Knowledge graph ontology exports
│   └── *.json                      # Graph snapshots of concept relationships
│
├── knowledge/                      # Per-agent memory (internal variant)
│   └── summary_*.md                # Cross-reference knowledge articles from sessions
│
├── todo/                           # Action items, research questions
│   └── *.md
│
└── output/                         # Generated insights, reports
    └── *.md
```

**Layer 1 — Raw Sources:** Immutable. The agent reads but never modifies these.
**Layer 2 — The Wiki:** Agent-owned markdown files. Created, updated, and
cross-referenced by the agent.
**Layer 3 — The Schema:** `SCHEMA.md` defines structure, conventions, and tag taxonomy.
**Layer 4 — The Graph (optional):** `infranodus/` stores knowledge graph snapshots for
gap analysis and visual navigation.

## Resuming an Existing Wiki (CRITICAL — do this every session)

When the user has an existing wiki, **always orient yourself before doing anything**:

① **Read `SCHEMA.md`** / **Read `CLAUDE.md`** — understand the domain, conventions, and agent guidelines.
② **Read `index.md`** — learn what pages exist and their summaries.
③ **Scan recent `log.md`** — read the last 20-30 entries to understand recent activity.

```bash
WIKI="${WIKI_PATH:-$HOME/wiki}"
# Orientation reads at session start
read_file "$WIKI/SCHEMA.md"
read_file "$WIKI/CLAUDE.md"  # if exists
read_file "$WIKI/index.md"
read_file "$WIKI/log.md" offset=<last 30 lines>
```

**New check:** If `infranodus/` exists and has `.json` files, load the most recent graph
snapshot — it reveals the current state of concept relationships and any gaps.

Only after orientation should you ingest, query, or lint. This prevents:
- Creating duplicate pages for entities that already exist
- Missing cross-references to existing content
- Contradicting the schema's conventions
- Repeating work already logged

## Iterating on an Existing Wiki (Multi-Pass Deepening)

When the user says **"this has been run before, this is a new iteration"** — the goal is to go **deeper into unexplored corners**, NOT to repeat prior passes. This is a distinct workflow from initial creation or one-shot ingest.

### Iteration Workflow

**Step 1: Reconstruct what was covered.** Read the log.md in full — each entry states its focus, what was discovered, and what files were created. Enumerate the ontology snapshots in `infranodus/` to see the graph evolution. Count existing pages by type (entities, concepts, comparisons, queries).

**Step 2: Identify the blind spots.** Systematically scan the domain using the categories checklist from `references/prompt-engineering-codebase-analysis.md` (for codebase wikis) or a comparable taxonomy for your domain. For each category, ask:
- "Is this category represented in the wiki?"
- "If yes, how deeply — one entity page covering everything, or dedicated pages per sub-component?"
- "If no, does the system/codebase actually have this? Have I looked in the right places?"

**Step 3: Parallel delegate discovery.** The most effective way to find new territory in a well-explored wiki is to dispatch 2-3 subagents simultaneously, each covering a structurally separate blind spot:

```python
import asyncio
async def scan_territory(name, path, checklist):
    return await delegate_task(
        goal=f"Find ALL new prompt-adjacent code in {name} territory",
        context=f"18-category taxonomy checklist: {checklist}. Already covered: [list prior depths]. Find what was MISSED.",
        toolsets=['terminal', 'file']
    )
results = await asyncio.gather(
    scan_territory("prompts", "src/core/prompts/", "..."),
    scan_territory("context", "src/core/context/", "..."),
    scan_territory("task_loop", "src/core/task/", "..."),
)
synthesize(results)  # Cross-package insights emerge from combined picture
```

**Step 4: Synthesize across territories.** Combine subagent findings before writing wiki pages. The cross-package connections (e.g., "this condition gate in task/index.ts controls that prompt variant in prompts/system.ts") are often the most valuable new discoveries.

**Step 5: Write the new depth.** Create 2-4 new wiki pages covering the newly explored territory. Each must link to at least 2 existing pages to integrate into the graph. Update the frontmatter confidence levels appropriately.

**Step 6: Version the ontology.** Generate a timestamped ontology JSON:
```
infranodus/ontology-YYYY-MM-DD-v<N>.json
```
Bump the iteration number. Record nodes, edges, and clusters against the prior version in the README's graph evolution table.

**Step 7: Update the README.** Add the new subgraphs to the Mermaid knowledge graph diagram. Update the iteration counter, page count, and graph evolution table. Document the new coverage domain.

**Step 8: Update index + log.** Add new pages to index.md under the correct sections. Append a detailed log entry documenting what was found and what files were created.

### Convergence Assessment (When to Stop)

Use the **wall assessment** from `references/progressive-deepening.md`:

| Dimension | Done (90-100%) | Partial (50-85%) | Sparse (0-45%) |
|-----------|---------------|------------------|-----------------|
| Directories scanned | Every top-level + key subdir checked | Main dir scanned, some subtrees skipped | Only entry points |
| Source lines read | All choke points + samples | Key files only | Structure only |
| Artifact coverage | All outputs enumerated | Count known, content unread | Unknown count |
| Legacy/deprecated paths | All found and documented | Some known | None known |
| Graph convergence | New iterations add <2 clusters | Adding 3-5 per iteration | New clusters every pass |

**Stop when:** new iterations consistently add 0-1 clusters and <5 nodes, gap analysis shows only minor bridge potential (<0.4), and the user's original question is fully answerable from existing content.

### Pitfalls for Iteration Mode

- **Don't re-read files you already covered** — trust the existing wiki pages. Read the log to know what was covered; don't re-scan directories that were already fully analyzed.
- **Don't write pages for the same depth** — if iteration 3 covered the hook system at the entity level, iteration 7 should trace hooks to their actual call sites, not re-describe what hooks are.
- **Parallel discovery is critical** — sequential passes through the same 18 categories yield diminishing returns. Dispatch subagents to structurally separate territories simultaneously to keep the convergence curve steep.
- **Snapshot counts are a common blind spot** — always enumerate from the filesystem, never assume. `ls __snapshots__/*.snap | wc -l` in iteration 4 revealed 56 snapshots when 10 were expected. This pattern recurs across codebases.
- **Mermaid diagram update is part of the iteration** — don't leave the README stale. The visual graph is how the user navigates the wiki; it must reflect the new depth.
- **Bare .md filenames in the README will be flagged.** When you update the Wiki Structure section, convert every `file.md` reference to `[[file]]`. The user will notice and ask you to fix it. Batch-convert the section before committing.

## Initializing a New Wiki

When the user asks to create or start a wiki:

1. **Ask which variant** — External KB or Internal Agent Memory (or both)
2. **Ask if they want the graph layer** (InfraNodus) — visual + MCP gap analysis
3. Determine the wiki path (from `$WIKI_PATH` env var, or ask the user; default `~/wiki`)
4. Create the directory structure above (include graph dirs if opted in)
5. Ask the user what domain the wiki covers — be specific
6. Write `SCHEMA.md` customized to the domain (see template below)
7. Write `CLAUDE.md` with agent guidelines (see template below)
8. Write `AGENTS.md` if Codex is used
9. Write initial `index.md` with sectioned header
10. Write initial `log.md` with creation entry
11. Confirm the wiki is ready and suggest first sources to ingest

### SCHEMA.md Template

Adapt to the user's domain. The schema constrains agent behavior and ensures consistency:

```markdown
# Wiki Schema

## Domain
[What this wiki covers — e.g., "AI/ML research", "personal health", "startup intelligence"]

## Conventions
- File names: lowercase, hyphens, no spaces (e.g., `transformer-architecture.md`)
- Every wiki page starts with YAML frontmatter (see below)
- Use `[[wikilinks]]` to link between pages (minimum 2 outbound links per page)
- When updating a page, always bump the `updated` date
- Every new page must be added to `index.md` under the correct section
- Every action must be appended to `log.md`
- **Provenance markers:** On pages that synthesize 3+ sources, append `^[raw/articles/source-file.md]`
  at the end of paragraphs whose claims come from a specific source. This lets a reader trace each
  claim back without re-reading the whole raw file. Optional on single-source pages where the
  `sources:` frontmatter is enough.

## Frontmatter
  ```yaml
  ---
  title: Page Title
  created: YYYY-MM-DD
  updated: YYYY-MM-DD
  type: entity | concept | comparison | query | summary
  tags: [from taxonomy below]
  sources: [raw/articles/source-name.md]
  # Optional quality signals:
  confidence: high | medium | low        # how well-supported the claims are
  contested: true                        # set when the page has unresolved contradictions
  contradictions: [other-page-slug]      # pages this one conflicts with
  ---
  ```

`confidence` and `contested` are optional but recommended for opinion-heavy or fast-moving
topics. Lint surfaces `contested: true` and `confidence: low` pages for review so weak claims
don't silently harden into accepted wiki fact.

### raw/ Frontmatter

Raw sources ALSO get a small frontmatter block so re-ingests can detect drift:

```yaml
---
source_url: https://example.com/article   # original URL, if applicable
ingested: YYYY-MM-DD
sha256: <hex digest of the raw content below the frontmatter>
---
```

The `sha256:` lets a future re-ingest of the same URL skip processing when content is unchanged,
and flag drift when it has changed. Compute over the body only (everything after the closing
`---`), not the frontmatter itself.

## Tag Taxonomy
[Define 10-20 top-level tags for the domain. Add new tags here BEFORE using them.]

Example for AI/ML:
- Models: model, architecture, benchmark, training
- People/Orgs: person, company, lab, open-source
- Techniques: optimization, fine-tuning, inference, alignment, data
- Meta: comparison, timeline, controversy, prediction

Rule: every tag on a page must appear in this taxonomy. If a new tag is needed,
add it here first, then use it. This prevents tag sprawl.

## Page Thresholds
- **Create a page** when an entity/concept appears in 2+ sources OR is central to one source
- **Add to existing page** when a source mentions something already covered
- **DON'T create a page** for passing mentions, minor details, or things outside the domain
- **Split a page** when it exceeds ~200 lines — break into sub-topics with cross-links
- **Archive a page** when its content is fully superseded — move to `_archive/`, remove from index

## Entity Pages — Human-Readable Format (CRITICAL)

**Every entity page MUST render all YAML frontmatter as visible markdown in the body.** 
The frontmatter is for agent parsing; the body is for human browsing. A human opening
the file must see *everything* the agent sees without opening the raw YAML.

### Required Body Sections

After the `---` frontmatter closing delimiter, every entity page must include:

```markdown
## Properties

| Field | Value |
|-------|-------|
| **Type** | system \| person \| project \| platform |
| **ID** | `page-slug` |
| **Aliases** | alt-name-1, alt-name-2 |
| **Confidence** | High \| Medium \| Low |
| **Created** | YYYY-MM-DD |
| **Updated** | YYYY-MM-DD |

## Tags

`#tag1` `#tag2` `#tag3`

## Relationships

| Predicate | Objects |
|-----------|---------|
| **Owned By** | [[owner-entity]] |
| **Depends On** | [[dep-a]], [[dep-b]] |
| **Uses** | [[tool-x]], [[tool-y]] |
```

- Every `triples:` key becomes a human-readable predicate name in the Relationships table
- Every object that has a matching entity file gets a `[[wikilink]]`
- The Properties table covers: type, id, aliases, confidence, created, updated (from frontmatter)
- Tags render as backtick-wrapped badges on a single line
- Preserve any existing narrative content below these metadata sections

### Example

See the `reformat-entities-core-five` story's completed entity files (the operator,
the agent operator, Atlas-agent, ollama, gitlab-server) as reference implementations.

## Concept Pages
One page per concept or topic. Include:
- Definition / explanation
- Current state of knowledge
- Open questions or debates
- Related concepts ([[wikilinks]])

## Comparison Pages
Side-by-side analyses. Include:
- What is being compared and why
- Dimensions of comparison (table format preferred)
- Verdict or synthesis
- Sources

## Update Policy
When new information conflicts with existing content:
1. Check the dates — newer sources generally supersede older ones
2. If genuinely contradictory, note both positions with dates and sources
3. Mark the contradiction in frontmatter: `contradictions: [page-name]`
4. Flag for user review in the lint report
```

### CLAUDE.md Template

The agent guidelines file. Tells any coding agent what this wiki is and how to work with it.

```markdown
# CLAUDE.md — LLM Wiki Agent Guidelines

## Project
This is an LLM Wiki — a persistent, compounding knowledge base on [DOMAIN].
Open it in Obsidian for graph view and visual navigation.

## Architecture Overview
Treat knowledge like code:
- RAW (`raw/`) = source code (immutable, never edit)
- WIKI (`wiki/`) = compiled executable (agent owns these files)
- INDEX (`index.md`) = entry point (agent reads this FIRST every session)
- LOG (`log.md`) = audit trail (append-only)

## Key Files
- `SCHEMA.md` — rules, conventions, tag taxonomy. Read before creating pages.
- `index.md` — catalog of every wiki page. Update when adding pages.
- `log.md` — chronological action log. Append after every action.

## Rules for This Wiki
1. Always read `index.md` first before answering questions
2. Every new page needs 2+ [[wikilinks]] to existing pages
3. Always update `index.md` when creating pages
4. Always append to `log.md` after any action
5. Tags must come from the taxonomy in `SCHEMA.md`
6. Frontmatter is required on every wiki page
7. Set `confidence: low|medium` for single-source claims
8. Split pages over 200 lines into sub-topics

## Variant: [EXTERNAL_KB | INTERNAL_MEMORY | BOTH]
[Specific instructions based on variant]

## Graph Layer
[If graph layer active:]
- `infranodus/` contains knowledge graph snapshots
- Use InfraNodus MCP server for gap analysis
- Visualize folders in Obsidian with InfraNodus plugin

## Startup Routine
When I start a new session:
1. Read this file
2. Read `SCHEMA.md`
3. Read `index.md`
4. Read last 20 lines of `log.md`
5. Check `infranodus/` for recent graph snapshots
```

### AGENTS.md Template

Same structure as CLAUDE.md but adapted for Codex's conventions.

### index.md Template

The index is sectioned by type. Each entry is one line: wikilink + summary.

```markdown
# Wiki Index

> Content catalog. Every wiki page listed under its type with a one-line summary.
> Read this first to find relevant pages for any query.
> Last updated: YYYY-MM-DD | Total pages: N

## Entities
<!-- Alphabetical within section -->
- [[page-slug]] — One-line summary

## Concepts

## Comparisons

## Queries

## Sources
```

**Scaling rule:** When any section exceeds 50 entries, split it into sub-sections
by first letter or sub-domain. When the index exceeds 200 entries total, create
a `_meta/topic-map.md` that groups pages by theme for faster navigation.

### log.md Template

```markdown
# Wiki Log

> Chronological record of all wiki actions. Append-only.
> Format: `## [YYYY-MM-DD] action | subject`
> Actions: ingest, update, query, lint, create, archive, delete, graph-analysis
> When this file exceeds 500 entries, rotate: rename to log-YYYY.md, start fresh.

## [YYYY-MM-DD] create | Wiki initialized
- Domain: [domain]
- Variant: [EXTERNAL_KB | INTERNAL_MEMORY | BOTH]
- Graph layer: [enabled | disabled]
- Structure created with SCHEMA.md, CLAUDE.md, index.md, log.md
```

## Core Operations

### 1. Ingest

When the user provides a source (URL, file, paste), integrate it into the wiki:

① **Capture the raw source:**
   - URL → use `web_extract` to get markdown, save to `raw/articles/`
   - PDF → use `web_extract` (handles PDFs), save to `raw/papers/`
   - Pasted text → save to appropriate `raw/` subdirectory
   - Name the file descriptively: `raw/articles/karpathy-llm-wiki-2026.md`
   - **Add raw frontmatter** (`source_url`, `ingested`, `sha256` of the body).
     On re-ingest of the same URL: recompute the sha256, compare to the stored value —
     skip if identical, flag drift and update if different. This is cheap enough to
     do on every re-ingest and catches silent source changes.

② **Discuss takeaways** with the user — what's interesting, what matters for
   the domain. (Skip this in automated/cron contexts — proceed directly.)

③ **Check what already exists** — search index.md and use `search_files` to find
   existing pages for mentioned entities/concepts. This is the difference between
   a growing wiki and a pile of duplicates.

④ **Write or update wiki pages:**
   - **New entities/concepts:** Create pages only if they meet the Page Thresholds
     in SCHEMA.md (2+ source mentions, or central to one source)
   - **Existing pages:** Add new information, update facts, bump `updated` date.
     When new info contradicts existing content, follow the Update Policy.
   - **Cross-reference:** Every new or updated page must link to at least 2 other
     pages via `[[wikilinks]]`. Check that existing pages link back.
   - **Tags:** Only use tags from the taxonomy in SCHEMA.md
   - **Provenance:** On pages synthesizing 3+ sources, append `^[raw/articles/source.md]`
     markers to paragraphs whose claims trace to a specific source.
   - **Confidence:** For opinion-heavy, fast-moving, or single-source claims, set
     `confidence: medium` or `low` in frontmatter. Don't mark `high` unless the
     claim is well-supported across multiple sources.

⑤ **Update navigation:**
   - Add new pages to `index.md` under the correct section, alphabetically
   - Update the "Total pages" count and "Last updated" date in index header
   - Append to `log.md`: `## [YYYY-MM-DD] ingest | Source Title`
   - **CRITICAL:** Use `read_file` first to get the existing content, then concatenate the old + new entry and `write_file` the whole thing. `write_file` OVERWRITES — if you call it without reading first, you destroy the entire log history.
   - List every file created or updated in the log entry

⑥ **Report what changed** — list every file created or updated to the user.

A single source can trigger updates across 5-15 wiki pages. This is normal
and desired — it's the compounding effect.

### 2. Query

When the user asks a question about the wiki's domain:

① **Read `index.md`** to identify relevant pages.
② **For wikis with 100+ pages**, also `search_files` across all `.md` files
   for key terms — the index alone may miss relevant content.
③ **Read the relevant pages** using `read_file`.
④ **Synthesize an answer** from the compiled knowledge. Cite the wiki pages
   you drew from: "Based on [[page-a]] and [[page-b]]..."
⑤ **File valuable answers back** — if the answer is a substantial comparison,
   deep dive, or novel synthesis, create a page in `queries/` or `comparisons/`.
   Don't file trivial lookups — only answers that would be painful to re-derive.
⑥ **Update log.md** with the query and whether it was filed.

### 3. Graph Analysis (NEW)

When the user asks to analyze the wiki's knowledge structure, find gaps, or visualize connections:

**Option A: Visual Plugin (Cursor/Obsidian)**

If the user has the InfraNodus plugin installed:
1. Right-click a folder (e.g., `wiki/concepts/`) → "Visualize as graph"
2. The plugin shows topics, clusters, and disconnected nodes
3. Use **Gap Analysis** to find clusters that could be better connected
4. Click **AI Advice** to generate a bridging question
5. Feed the bridging question back into the agent to generate new insights

```bash
# The bridging question is a structured prompt containing:
# 1. The two disconnected clusters from the graph
# 2. Key statements from each cluster (extracted from concept docs)
# 3. A request to generate a research question bridging them
```

**Option B: InfraNodus MCP Server**

If the InfraNodus MCP server is configured, the agent can call it directly:

```python
# Pseudocode — the agent calls the MCP tool:
# infranodus_generate_knowledge_graph(path="wiki/concepts/")
# Returns: {clusters: [...], gaps: [...], main_topics: [...], recommendations: [...]}
```

1. Call `infranodus_generate_knowledge_graph` on the concepts folder
2. Receive graph structure: clusters, topical overview, gaps
3. Use the gap analysis to generate research questions
4. Save the research question to `todo/` and log the action

**Option C: Ontology Snapshots**

When the agent ingests sources or generates insights, save knowledge graph snapshots:

1. After ingest, generate an ontology graph of the new concepts/connections
2. Save to `infranodus/` as JSON with timestamp: `infranodus/ontology-YYYY-MM-DD.json`
3. These snapshots become a living memory of how concept relationships evolve
4. On session resume, load the most recent snapshot to understand current state
5. **CRITICAL: Enumerate snapshots from the filesystem, never assume counts.** In codebase
   analysis, `ls __snapshots__/*.snap | wc -l` may reveal 56 files when you expected 10. Parse
   filenames to build the full test matrix (model families × flag combinations × special variants).
   Assumption gaps in snapshot counts are the #1 blind spot in prompt-system reverse-engineering.

```bash
# Example ontology graph structure (JSON):
# {
#   "nodes": [{"id": "transformer", "label": "Transformer", "cluster": 1}, ...],
#   "edges": [{"source": "transformer", "target": "attention", "weight": 0.9}, ...],
#   "clusters": [
#     {"id": 1, "label": "Core Architecture", "size": 12},
#     {"id": 2, "label": "Training Methods", "size": 8}
#   ],
#   "gaps": [
#     {"source_cluster": 1, "target_cluster": 2, "bridge_potential": 0.6}
#   ]
# }
```

**Option D: Manual Gap Analysis Prompt**

When no graph tools are available, the agent can do a text-based gap analysis:

1. Read all files in `wiki/concepts/`
2. Extract all `[[wikilinks]]` — build a link graph
3. Identify clusters of closely-linked concepts
4. Find concept pairs with zero direct links that logically should connect
5. Present findings to the user as potential research questions

### 4. Internal Agent Memory (NEW — Cole Medin Pattern)

When the user wants to set up or maintain internal agent memory (Variant B):

**Setup:**
1. Add a `knowledge/` directory to the wiki
2. Configure Claude Code hooks to auto-capture session logs:
   ```bash
   # In .claude/settings.json or equivalent:
   # {"hooks": {"post-session": "process-session-log.sh"}}
   ```
3. The hook script passes the session log to the LLM, which:
   - Extracts key decisions, patterns, and learnings
   - Cross-references with existing `knowledge/` articles
   - Creates or updates summary files: `knowledge/summary_<topic>.md`

**Per-Session:**
1. Agent starts → reads `knowledge/` directory → understands project history
2. Agent works → session log is captured automatically
3. Agent ends → hook fires → session is distilled into knowledge articles
4. Knowledge compounds over time — agent gets smarter about the codebase

**Knowledge Article Format:**
```markdown
---
topic: authentication-flow
created: 2026-05-10
updated: 2026-05-12
sessions: [session-20260510, session-20260512]
related: [user-management, oauth-provider]
confidence: high
---
## Key Decisions
- Using JWT over session-based auth for scalability (session-20260510)
- Token refresh set to 15min expiry (session-20260512)

## Architecture Notes
- Auth middleware lives in `src/middleware/auth.ts`
- User roles are stored in the `roles` claim of the JWT

## Open Questions
- Should we add refresh token rotation?
```

### 5. Lint

When the user asks to lint, health-check, or audit the wiki:

① **Orphan pages:** Find pages with no inbound `[[wikilinks]]` from other pages.
```python
# Use execute_code for this — programmatic scan across all wiki pages
import os, re
from collections import defaultdict
wiki = "<WIKI_PATH>"
# Scan all .md files in entities/, concepts/, comparisons/, queries/
# Extract all [[wikilinks]] — build inbound link map
# Pages with zero inbound links are orphans
```

② **Broken wikilinks:** Find `[[links]]` that point to pages that don't exist. Scan **ALL** `.md` files (not just `index.md`) — cross-reference every unique slug against actual filenames on disk. Watch for false positives:
    - Shell code inside fenced code blocks: `[[ "$COMMAND" == *"rm"* ]]` is NOT a wikilink
    - `[[NOTE]]` and similar annotation markers — only match if the inner text matches a slug pattern
    - Slugs with spaces or special characters — verify with a wide regex: `\[\[([^\]]+)\]\]`

③ **Index completeness:** Every wiki page should appear in `index.md`. Compare
   the filesystem against index entries.

④ **Frontmatter validation:** Every wiki page must have all required fields
   (title, created, updated, type, tags, sources). Tags must be in the taxonomy.

⑤ **Stale content:** Pages whose `updated` date is >90 days older than the most
   recent source that mentions the same entities.

⑥ **Contradictions:** Pages on the same topic with conflicting claims. Look for
   pages that share tags/entities but state different facts. Surface all pages
   with `contested: true` or `contradictions:` frontmatter for user review.

⑦ **Quality signals:** List pages with `confidence: low` and any page that cites
   only a single source but has no confidence field set — these are candidates
   for either finding corroboration or demoting to `confidence: medium`.

⑧ **Source drift:** For each file in `raw/` with a `sha256:` frontmatter, recompute
   the hash and flag mismatches. Mismatches indicate the raw file was edited
   (shouldn't happen — raw/ is immutable) or ingested from a URL that has since
   changed. Not a hard error, but worth reporting.

⑨ **Page size:** Flag pages over 200 lines — candidates for splitting.

⑩ **Tag audit:** List all tags in use, flag any not in the SCHEMA.md taxonomy.

⑪ **Log rotation:** If log.md exceeds 500 entries, rotate it.

⑫ **Graph health (NEW):** If `infranodus/` exists:
    - Count graph snapshots — flag if none updated in 30+ days
    - Check for concept pages with no graph representation
    - Suggest re-generating ontology graph if structure has changed significantly

⑬ **Report findings** with specific file paths and suggested actions, grouped by
   severity (broken links > orphans > source drift > contested pages > stale content > style issues).

⑭ **Append to log.md:** `## [YYYY-MM-DD] lint | N issues found`

### 5b. Broken Wikilink Resolution

When the lint scan finds broken `[[wikilinks]]`, do not fix them one at a time — **batch-resolve** in a single pass:

1. **Collect all broken slugs.** Extract every unique slug referenced by `[[slug]]` across ALL `.md` files, then subtract slugs that correspond to an actual `.md` file on disk. The remainder are broken links:

```python
import os, re
all_files = terminal("find . -name '*.md' | sort")  # all .md files
slug_set = set(f.split('/')[-1].replace('.md','') for f in all_files)

# Scan every file for [[wikilinks]]
all_wikilinks = set()
for f in all_files:
    content = read_file(f)
    all_wikilinks.update(re.findall(r'\[\[([^\]]+)\]\]', content))
broken = all_wikilinks - slug_set
```

2. **Categorize the broken slugs.**
    - **Real missing pages** — intended to exist but never created (e.g., component pages, source annotations). These need stub files.
    - **Slug errors** — the slug doesn't match the target filename (e.g., `[[jsonToolToXml converters]]` has a space; the file is `json-tool-to-xml-converters.md`). Fix the wikilink text, not the filename.
    - **False positives** — `[[NOTE]]`, `[[ "$COMMAND" ]]` inside code blocks, etc. These are not wikilinks. Replace `[[` with `[` or put the text in a fenced code block where Obsidian won't parse it.

3. **Batch-create stub pages for real missing pages.** Create all stubs in one go using `write_file`. Each stub needs:
    - Minimal YAML frontmatter (title, created, updated, type, tags, confidence)
    - A one-paragraph description of what this page covers
    - 2+ `[[wikilinks]]` to existing related pages
    - If the page is a source annotation (`sources/`), also link to the entity/concept pages it documents

    ```yaml
    ---
    title: Page Title
    created: YYYY-MM-DD
    updated: YYYY-MM-DD
    type: entity | concept | comparison | query | summary
    tags: [tag1, tag2]
    confidence: medium | low
    ---
    ```

4. **Fix slug errors.** Change the `[[wikilink]]` text in the referencing files (not the filename). Use `patch` with exact string matching.

5. **Fix false positives.** Replace `[[NOTE]]` with `[NOTE]` or backtick-escape the brackets. For shell code in code blocks, no change is needed — fenced code blocks are not parsed for wikilinks by Obsidian.

6. **Re-scan to verify zero broken links.** Run the same scan again from step 1 and confirm the broken set is empty.

7. **Update the index.** Increment the `Total pages: N` count in `index.md` to reflect the new stubs. Update `Last updated:` date.

8. **Log the resolution.** Append to `log.md` with counts of pages created, slug errors fixed, and false positives identified.

**Common categories of missing pages found in practice:**
- **Component pages** — agents often reference sub-sections of a system as `[[capabilities-component]]` etc. without creating the stub
- **Source annotations** — `[[source-claude-snapshot]]`, `[[source-variant-index]]` etc. are listed in the index but never written to `sources/`
- **Cross-reference targets** — concept pages that other pages link to but never got created

## Working with the Wiki

### Progressive Deepening (Multi-Pass Codebase Analysis)

For complex codebase analysis (e.g., reverse-engineering a large prompt system), use the
**three-pass progressive deepening** pattern from [[references/progressive-deepening.md]]:
1. **Architecture surface** — file layout, module boundaries, structural entities
2. **Actual content** — runtime outputs, generated snapshots, what the system produces
3. **Edge cases & hidden systems** — hooks, legacy code, loading pipelines, test fixtures

**Between each pass, ask "what did I NOT look at?"** Use the 18-category taxonomy in
[[references/prompt-engineering-codebase-analysis.md]] as a checklist — it catalogs every
kind of prompt-adjacent code (engines, condition gates, hooks, rule sources, rule pipeline,
context management, trackers, mentions, permissions, snapshots, SDK prompts, tools, focus
chain, skills, workflows, config loaders). Check each category you haven't visited yet and
ask: "Does this system have this? Where is it? Have I scanned that directory?"

After each pass, generate an ontology graph per pass — each should have more clusters and deeper edges than the last.

### Searching

```bash
# Find pages by content
search_files "transformer" path="$WIKI" file_glob="*.md"

# Find pages by filename
search_files "*.md" target="files" path="$WIKI"

# Find pages by tag
search_files "tags:.*alignment" path="$WIKI" file_glob="*.md"

# Recent activity
read_file "$WIKI/log.md" offset=<last 20 lines>
```

### Bulk Ingest

When ingesting multiple sources at once, batch the updates:
1. Read all sources first
2. Identify all entities and concepts across all sources
3. Check existing pages for all of them (one search pass, not N)
4. Create/update pages in one pass (avoids redundant updates)
5. Update index.md once at the end
6. Write a single log entry covering the batch
7. If graph layer is active, generate a single ontology snapshot for the batch

**Batch stub creation:** When creating 10+ pages in a single pass (e.g., resolving broken wikilinks or seeding a new sub-directory), write all files before updating index.md or log.md. This avoids partial-state commits and makes the batch atomic in git history.

### Archiving

When content is fully superseded or the domain scope changes:
1. Create `_archive/` directory if it doesn't exist
2. Move the page to `_archive/` with its original path (e.g., `_archive/entities/old-page.md`)
3. Remove from `index.md`
4. Update any pages that linked to it — replace wikilink with plain text + "(archived)"
5. Log the archive action

### Obsidian Integration

The wiki directory works as an Obsidian vault out of the box:
- `[[wikilinks]]` render as clickable links
- Graph View visualizes the knowledge network
- YAML frontmatter powers Dataview queries
- The `raw/assets/` folder holds images referenced via `![[image.png]]`

For best results:
- Set Obsidian's attachment folder to `raw/assets/`
- Enable "Wikilinks" in Obsidian settings (usually on by default)
- Install **InfraNodus plugin** for knowledge graph gap analysis
- Install Dataview plugin for queries like `TABLE tags FROM "entities" WHERE contains(tags, "company")`

If using the Obsidian skill alongside this one, set `OBSIDIAN_VAULT_PATH` to the
same directory as the wiki path.

### Obsidian Headless (servers and headless machines)

On machines without a display, use `obsidian-headless` instead of the desktop app.
It syncs vaults via Obsidian Sync without a GUI — perfect for agents running on
servers that write to the wiki while Obsidian desktop reads it on another device.

**Setup:**
```bash
# Requires Node.js 22+
npm install -g obsidian-headless

# Login (requires Obsidian account with Sync subscription)
ob login --email <email> --password '<password>'

# Create a remote vault for the wiki
ob sync-create-remote --name "LLM Wiki"

# Connect the wiki directory to the vault
cd ~/wiki
ob sync-setup --vault "<vault-id>"

# Initial sync
ob sync

# Continuous sync (foreground — use systemd for background)
ob sync --continuous
```

**Continuous background sync via systemd:**
```ini
# ~/.config/systemd/user/obsidian-wiki-sync.service
[Unit]
Description=Obsidian LLM Wiki Sync
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/path/to/ob sync --continuous
WorkingDirectory=/home/user/wiki
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now obsidian-wiki-sync
# Enable linger so sync survives logout:
sudo loginctl enable-linger $USER
```

This lets the agent write to `~/wiki` on a server while you browse the same
vault in Obsidian on your laptop/phone — changes appear within seconds.

## Pitfalls

- **Never modify files in `raw/`** — sources are immutable. Corrections go in wiki pages.
- **Always orient first** — read CLAUDE.md + SCHEMA + index + recent log before any operation.
  Skipping this causes duplicates and missed cross-references.
- **Always update index.md and log.md** — skipping this makes the wiki degrade. These are the
  navigational backbone.
- **Don't create pages for passing mentions** — follow the Page Thresholds in SCHEMA.md. A name
  appearing once in a footnote doesn't warrant an entity page.
- **Don't create pages without cross-references** — isolated pages are invisible. Every page must
  link to at least 2 other pages.
- **Frontmatter is required** — it enables search, filtering, and staleness detection.
- **Tags must come from the taxonomy** — freeform tags decay into noise. Add new tags to SCHEMA.md
  first, then use them.
- **Keep pages scannable** — a wiki page should be readable in 30 seconds. Split pages over
  200 lines. Move detailed analysis to dedicated deep-dive pages.
- **Ask before mass-updating** — if an ingest would touch 10+ existing pages, confirm
  the scope with the user first.
- **Rotate the log** — when log.md exceeds 500 entries, rename it `log-YYYY.md` and start fresh.
- **Handle contradictions explicitly** — don't silently overwrite. Note both claims with dates,
  mark in frontmatter, flag for user review.
- **Graph layer is optional** — don't force it. Ask the user if they want InfraNodus setup.
- **Visual gap analysis complements, doesn't replace, lint** — the graph finds structural gaps
  in concept connections; lint finds data integrity issues. Run both.
- **Ontology graphs drift** — re-generate snapshots after significant ingests, not every single
  edit. Weekly or per-batch is sufficient.
- **Don't over-index on the graph** — the wiki index + agent navigation is the primary interface.
  The graph is for finding *what's missing*, not for day-to-day querying.
- **Session logs in Variant B are sensitive** — they contain full agent-human conversations.
  The knowledge articles should distill decisions and patterns, not reproduce raw logs.
- **Mermaid diagram syntax hazards:** When generating knowledge graph Mermaid diagrams from
  ontology JSON, AVOID ALL `()` in node labels — both function calls (`getSystemPrompt()`) AND
  parenthetical notes (`(dead)`, `(2)`, `(experimental)`) break parsing. Replace `(dead)` →
  `dead code`, `(2)` → `2`, `(experimental)` → `experimental` before committing. AVOID
  `.method()` patterns like `.map()` — rewrite as plain text. AVOID digits touching units
  (`1MB` → `1 MB cap`). After writing, grep for parentheses inside bracket labels:
  `awk '/```mermaid/,/```/' README.md | grep -n '\\[.*('` to catch any survivors. Cross-subgraph
  edges work fine (e.g., `node_in_C0 -.->|label| node_in_C5`).
- **Bare `.md` filenames in listings are NOT clickable.** When describing the wiki structure\n  in a README or any narrative text, never write `file.md` — use `[[file]]` instead. A code\n  block can show the directory tree, but any file reference in prose (entity lists, concept\n  summaries, key findings tables) must be a wikilink. The user will notice bare filenames\n  and ask you to link them.\n- **Dual-purpose knowledge repos (agent entities + human interaction space).** When the\n  user wants a master knowledge graph, don't stop at SPO entity files. Add a `journal/`,\n  `inbox/`, `tasks/`, `dashboard/`, and `notable/` directory so the human has a readable\n  space too. See `references/dual-purpose-knowledge-repo.md` for the full pattern.
- **log.md is append-only but write_file overwrites.** Every instruction says "append to
  log.md" but `write_file` replaces the entire file. Always read the existing log content
  first, then concatenate: `old_content + new_entry`. If you forgot and already overwrote,
  restore from session history or git history before re-committing.

## Related Tools

- [llm-wiki-compiler](https://github.com/atomicmemory/llm-wiki-compiler) — Node.js CLI that
  compiles sources into a concept wiki. Good for batch compile workflows.
- [InfraNodus](https://infranodus.com) — Knowledge graph visualization + gap analysis tool.
  Offers VS Code plugin, Obsidian plugin, and MCP server.
- [Obsidian](https://obsidian.md) — Markdown editor with graph view and Dataview.
- [Cole Medin's Agent Memory](https://github.com/coleam00/agent-memory) — Claude Code memory
  system built on Karpathy's pattern for internal knowledge.

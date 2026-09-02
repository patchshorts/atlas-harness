# @atlasai/atsh-tool-memory

English | [中文](README.zh.md)

Model-facing semantic memory tools over the `ctx.memoryStore` seam: `memory_recall`,
`memory_get`, `memory_list`, `memory_retain`, and `memory_reflect`.

## What it adds

- `memory_retain` — store durable facts/decisions/preferences verbatim, with optional
  namespace and metadata. Accepts a single `content` string OR an `items` array of
  `{content, namespace?, metadata?}` facts to store many in ONE call (each stored verbatim).
- `memory_recall` — retrieve the most relevant stored memories for a query, ranked by a 0..1
  relevance score, with optional namespace scope and limit (a possibly-incomplete top subset;
  hard ceiling 50 — use `memory_list`/`memory_reflect` for the full store).
- `memory_get` — retrieve ONE stored memory byte-exactly by its content string (not top-k);
  the exact-recovery path for facts stored under a known key/value shape.
- `memory_list` — retrieve EVERY stored memory verbatim, uncapped (not a top-k subset); the
  exhaustive exact-recovery path that returns the complete contents of a namespace or the
  whole store, newest first.
- `memory_reflect` — summarize the store: totals, per-namespace distribution, most recent.

The tools are snake_case (like `todo_write`), need no agent session, and operate purely on
`ctx.memoryStore` — mount any backend that registers it (`@atlasai/atsh-memory` provides
the default SQLite one).

## Usage

```ts
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@atlasai/atsh-system-prompt'
import ToolRuntime from '@atlasai/atsh-tools'
import * as Memory from '@atlasai/atsh-memory'
import * as ToolMemory from '@atlasai/atsh-tool-memory'

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
await ctx.plugin(Memory, { backend: 'sqlite', sqlite: { path: ':memory:' } })
await ctx.plugin(ToolMemory, {})
```

## Known Limitations and Deferred Work

- Recall relevance is lexical (token overlap) unless the memory backend supplies embeddings.
- No deletion/forgetting tool yet.
- Added additively to the frozen upstream clone: registers tools on `ctx.tools`
  and touches no existing package source.

# @atlasai/atsh-memory

English | [中文](README.zh.md)

Semantic memory for the DeepSeek Harness: a `ctx.memoryStore` service seam with a
zero-dependency SQLite backend (default) and a config-gated pgvector adapter. The companion
`@atlasai/atsh-tool-memory` package exposes the model-facing `memory_retain` /
`memory_recall` / `memory_get` / `memory_list` / `memory_reflect` tools.

## What it adds

- `ctx.memoryStore` — the abstract `MemoryStore` service (`retain` / `get` / `list` / `recall` / `reflect`).
- `SqliteMemoryBackend` — the default backend, backed by Node's built-in `node:sqlite`
  (no npm dependency). Works out of the box with no external services.
- `PgVectorMemoryBackend` — a config-gated adapter for Postgres + pgvector (see below).

## Usage

```ts
import { Context } from '@deepseek-ai/cordis'
import * as Memory from '@atlasai/atsh-memory'

const ctx = new Context()
await ctx.plugin(Memory, { backend: 'sqlite', sqlite: { path: './memory.db' } })
// `:memory:` (the default) keeps the store in-process; a file path persists it.

await ctx.memoryStore.retain({ content: 'the user prefers concise answers', namespace: 'prefs' })
const matches = await ctx.memoryStore.recall('concise answers')
// recall returns a ranked top-limit subset (default 10, hard ceiling 50);
// use memoryStore.list for the complete, uncapped store:
const everything = await ctx.memoryStore.list({ namespace: 'prefs' })
const summary = await ctx.memoryStore.reflect()
```

## Config (schemastery)

| key | type | default | meaning |
| --- | --- | --- | --- |
| `backend` | `'sqlite' \| 'pgvector'` | `'sqlite'` | storage backend |
| `sqlite.path` | `string` | `':memory:'` | SQLite database file path |
| `pgvector.connectionString` | `string` | — | Postgres connection string |
| `pgvector.table` | `string` | `'memories'` | table name (trusted identifier) |
| `pgvector.embed` | `function` | — | embedding function for recall ranking |

## pgvector backend

The `pgvector` backend is opt-in and requires the operator to install the driver (deliberately
NOT a dependency of this package) and provision the extension:

```sh
pnpm add pg
```

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE memories (
  id TEXT PRIMARY KEY, namespace TEXT NOT NULL, content TEXT NOT NULL,
  metadata TEXT NOT NULL, created_at BIGINT NOT NULL, embedding vector(1536)
);
```

`embed(text) -> number[]` computes query and record embeddings; recall then ranks by cosine
similarity. Without `embed`, the adapter falls back to the same lexical token-overlap scoring
as the SQLite backend. Table names are interpolated into SQL — only ever configure a trusted
identifier.

## Known Limitations and Deferred Work

- The SQLite backend ranks recall by lexical token overlap only — no in-process embeddings.
- No retention/eviction policy yet: the store grows monotonically.
- Added additively to the frozen upstream clone: registers `ctx.memoryStore`
  and touches no existing package source.

# @atlasai/atsh-kgraph

English | [中文](README.zh.md)

OKR knowledge graph for the DeepSeek Harness: a `ctx.kgraph` service seam with a
zero-dependency SQLite backend (default). The companion `@atlasai/atsh-tool-kgraph`
package exposes the model-facing `kgraph_upsert_objective` / `kgraph_record_evidence` /
`kgraph_query` tools.

## What it adds

- `ctx.kgraph` — the OKR graph service: objectives, key results, and evidence rows.
- `buildGraphFromSession(sessionId)` — a deterministic autobuilder that ingests the
  append-only session event log: a `user/message` event seeds an objective; `assistant/message`
  and `tool/result` events become evidence rows. Replays are idempotent per
  `(session_id, seq)`.
- Default `SqliteKGraphStore` backend over `node:sqlite` (`:memory:` default).

## Config

| key | type | default | meaning |
| --- | --- | --- | --- |
| `sqlite.path` | `string` | `':memory:'` | kgraph database file path |
| `reader` | `(sessionId) => Promise<Snapshot>` | internal | session-log reader override (test seam; production reads `ctx.sessionQuery`) |

Unknown config keys are rejected at load time (`Config: unknown key "..."`).

## Model experience

The autobuilder is a READ-ONLY consumer of the session event log: it reads events, it never
writes to the session, and it never rewrites model-visible content — the prefix cache stays
valid across ingestion. Objectives and evidence are derived deterministically (type-based
extraction, no LLM judgment), so the same session log produces the same graph.

## Known Limitations and Deferred Work

- The harness storage hub (`ctx.storage` KV units) integration is deferred — this package
  uses `node:sqlite` directly today.
- Extraction is deterministic type/keyword-based; there is no semantic entity resolution
  (two wordings of the same objective produce two rows).
- No graph traversal queries yet — the store is flat objective / key-result / evidence
  rows; `kgraph_query` lists rather than traverses.

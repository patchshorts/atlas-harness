# @atlasai/atsh-tool-kgraph

English | [中文](README.zh.md)

Model-facing OKR knowledge-graph tools over the `ctx.kgraph` seam: `kgraph_upsert_objective`,
`kgraph_record_evidence`, and `kgraph_query`.

## What it adds

- `kgraph_upsert_objective` — record or update an objective (name, optional description).
- `kgraph_record_evidence` — attach one evidence row to an objective (objectiveId, optional
  krId, note).
- `kgraph_query` — list objectives with key results plus aggregate stats.

## Mounting

Loads only while both `tools` and `kgraph` are composed. Mount alongside
`@atlasai/atsh-kgraph` (or any backend registering `ctx.kgraph`):

```ts
await ctx.plugin(KGraphPlugin, { sqlite: { path: ':memory:' } })
await ctx.plugin(ToolKGraphPlugin, {})
```

## Known Limitations and Deferred Work

- No semantic search over the graph yet — `kgraph_query` lists objectives, it does not
  answer natural-language questions.
- Evidence recorded via the tool is flat (`eventType: 'tool/kgraph'`, `seq: 0`) — it is
  not linked to a specific session event.

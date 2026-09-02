# @atlasai/atsh-tool-kgraph
[English](README.md) | 中文

基于 `ctx.kgraph` 扩展点的面向模型 OKR 知识图谱工具：
`kgraph_upsert_objective`、`kgraph_record_evidence` 和 `kgraph_query`。

## 新增内容

- `kgraph_upsert_objective` — 记录或更新一个目标（name，可选 description）。
- `kgraph_record_evidence` — 向一个目标附加一行证据（objectiveId，可选
  krId，note）。
- `kgraph_query` — 列出带关键结果的目标以及汇总统计。

## 挂载

仅在 `tools` 与 `kgraph` 同时组合时加载。与
`@atlasai/atsh-kgraph`（或任何注册 `ctx.kgraph` 的后端）一起挂载：

```ts
await ctx.plugin(KGraphPlugin, { sqlite: { path: ':memory:' } })
await ctx.plugin(ToolKGraphPlugin, {})
```

## 已知限制与暂缓事项

- 目前还没有对图谱的语义搜索——`kgraph_query` 列出目标，
  但不回答自然语言问题。
- 通过工具记录的证据是扁平的（`eventType: 'tool/kgraph'`、`seq: 0`）——
  它不关联到特定的会话事件。

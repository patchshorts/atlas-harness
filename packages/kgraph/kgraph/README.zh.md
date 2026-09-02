# @atlasai/atsh-kgraph
[English](README.md) | 中文

面向 DeepSeek Harness 的 OKR 知识图谱：一个 `ctx.kgraph` 服务扩展点，
带有零依赖的 SQLite 后端（默认）。
配套的 `@atlasai/atsh-tool-kgraph` 包提供面向模型的
`kgraph_upsert_objective` / `kgraph_record_evidence` / `kgraph_query` 工具。

## 新增内容

- `ctx.kgraph` — OKR 图谱服务：目标、关键结果和证据行。
- `buildGraphFromSession(sessionId)` — 确定性自动构建器，摄取
  只追加的会话事件日志：`user/message` 事件会种下一个目标；
  `assistant/message` 和 `tool/result` 事件会变成证据行。按
  `(session_id, seq)` 重放是幂等的。
- 默认后端为基于 `node:sqlite` 的 `SqliteKGraphStore`（默认为 `:memory:`）。

## 配置

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `sqlite.path` | `string` | `':memory:'` | kgraph 数据库文件路径 |
| `reader` | `(sessionId) => Promise<Snapshot>` | internal | 会话日志读取器覆盖项（测试接缝；生产环境读取 `ctx.sessionQuery`） |

加载时会拒绝未知配置键（`Config: unknown key "..."`）。

## 模型体验

自动构建器是会话事件日志的只读消费方：它读取事件，从不写入
会话，也从不改写模型可见的内容——前缀缓存
在整个摄取过程中保持有效。目标和证据都是确定性推导的
（基于类型的提取，无 LLM 判断），因此相同的会话日志总是生成相同的图谱。

## 已知限制与暂缓事项

- 与 harness 存储中心（`ctx.storage` KV 单元）的集成暂缓处理——
  本包目前直接使用 `node:sqlite`。
- 提取是基于类型/关键字的确定性过程；没有语义实体消解
  （同一目标的两种表述会产生两行）。
- 目前还没有图谱遍历查询——存储只是扁平的目标 / 关键结果 / 证据行；
  `kgraph_query` 做的是列出而非遍历。

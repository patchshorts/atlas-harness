# @atlasai/atsh-memory
[English](README.md) | 中文

DeepSeek Harness 的语义记忆（semantic memory）：一个 `ctx.memoryStore` 服务 seam，带零依赖的 SQLite 后端（默认）和一个由配置启用的 pgvector 适配器。配套的 `@atlasai/atsh-tool-memory` 包提供面向模型的 `memory_retain` / `memory_recall` / `memory_reflect` 工具。

## 新增内容

- `ctx.memoryStore` —— 抽象的 `MemoryStore` 服务（`retain` / `recall` / `reflect`）。
- `SqliteMemoryBackend` —— 默认后端，基于 Node 内置的 `node:sqlite`（无 npm 依赖）。开箱即用，无需任何外部服务。
- `PgVectorMemoryBackend` —— 面向 Postgres + pgvector 的配置启用型适配器（见下文）。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis'
import * as Memory from '@atlasai/atsh-memory'

const ctx = new Context()
await ctx.plugin(Memory, { backend: 'sqlite', sqlite: { path: './memory.db' } })
// `:memory:` (the default) keeps the store in-process; a file path persists it.

await ctx.memoryStore.retain({ content: 'the user prefers concise answers', namespace: 'prefs' })
const matches = await ctx.memoryStore.recall('concise answers')
const summary = await ctx.memoryStore.reflect()
```

## 配置（schemastery）

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `backend` | `'sqlite' \| 'pgvector'` | `'sqlite'` | 存储后端 |
| `sqlite.path` | `string` | `':memory:'` | SQLite 数据库文件路径 |
| `pgvector.connectionString` | `string` | — | Postgres 连接字符串 |
| `pgvector.table` | `string` | `'memories'` | 表名（受信任的标识符） |
| `pgvector.embed` | `function` | — | 用于召回排序的嵌入函数 |

## pgvector 后端

`pgvector` 后端为可选启用，需要操作者自行安装驱动程序（刻意不作为本包的依赖）并预置该扩展：

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

`embed(text) -> number[]` 计算查询与记录的嵌入向量；召回随后按余弦相似度排序。未配置 `embed` 时，适配器退回到与 SQLite 后端相同的词法 token 重叠打分。表名会被拼接进 SQL——请只配置受信任的标识符。

## 已知限制与暂缓事项

- SQLite 后端仅按词法 token 重叠对召回排序——没有进程内嵌入。
- 尚无保留/淘汰策略：存储会单调增长。
- 以附加方式加入冻结的上游克隆（the Atlas CI additions）：注册 `ctx.memoryStore`，不触碰任何现有包的源码。

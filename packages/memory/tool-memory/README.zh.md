# @atlasai/atsh-tool-memory
[English](README.md) | 中文

面向模型的语义记忆工具，基于 `ctx.memoryStore` seam：`memory_recall`、`memory_retain` 和 `memory_reflect`。

## 新增内容

- `memory_retain` —— 原样存储一条持久的事实/决策/偏好，可带命名空间和元数据。
- `memory_recall` —— 检索与查询最相关的已存记忆，按 0..1 相关度分数排序，可带命名空间范围和数量上限。
- `memory_reflect` —— 汇总存储：总数、按命名空间的分布、最近条目。

这些工具采用 snake_case 命名（如 `todo_write`），不需要 agent（智能体）会话，并且纯粹基于 `ctx.memoryStore` 工作——挂载任何注册了该服务的后端即可（`@atlasai/atsh-memory` 提供默认的 SQLite 后端）。

## 用法

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

## 已知限制与暂缓事项

- 除非记忆后端提供嵌入向量，否则召回相关性是词法的（token 重叠）。
- 尚无删除/遗忘工具。
- 以附加方式加入冻结的上游克隆（the Atlas CI additions）：在 `ctx.tools` 上注册工具，不触碰任何现有包的源码。

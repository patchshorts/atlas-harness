# @atlasai/atsh-coordination
[English](README.md) | 中文

DeepSeek Harness 的 C2 编排（controller-of-controllers）：`ctx.coordination` 服务通过现有的 subagent 注册表（`ctx.subagents`）派生子 agent「worker」，并通过 SQLite 支撑的共享状态通道协调它们。注册表只被消费、从不修改——coordination 在由其他包注册并拥有的提供方之上增加了一层控制器。

## 新增内容

- `ctx.coordination` —— `CoordinationService` 服务。作为插件加载；它需要 subagent 注册表（`static inject = ['subagents']`），并且每个 context 注册一个服务（加载第二个会抛出异常，这是 cordis 标准的重复服务行为）。
- Worker 注册表 —— `spawnWorker(provider, request)` 在 `ctx.subagents` 中查找提供方、启动运行、在 `coord_workers` 表中插入一行 `'running'`、等待运行结算，然后把该行翻转为 `'completed'`（outcome = 拼接的文本输出；若运行返回了结构化结果则为 `JSON.stringify(structured)`）或 `'failed'`（outcome = 错误文本）。
- 共享状态通道 —— `postState(channel, key, value)` 以从 1 开始、按 (channel, key) 单调递增的修订号 upsert 一个 JSON 序列化条目；`getState(channel, key)` 与 `listChannel(channel)` 读回条目（JSON 往返）。写入以 `TypeError` 拒绝不可序列化的值。
- SQLite 后端 —— 行落入 `coord_workers` 与 `coord_shared_state` 表（Node 内置的 `node:sqlite`；无 npm 依赖），所属 fiber 卸载时关闭。`SCHEMA_VERSION = 1` 标记该 schema。
- 公共接口：`spawnWorker()`、`getWorker()`、`listWorkers()`、`getStats()`、`postState()`、`getState()`、`listChannel()`。
- 事件：`coordination/worker-started`（`{ workerId, provider }`）与 `coordination/worker-completed`（`{ workerId, provider, status }`），两者都在各自的行落库后发出。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@atlasai/atsh-subagent'
import CoordinationService from '@atlasai/atsh-coordination'

const ctx = new Context()
await ctx.plugin(SubagentRuntime)
// providers register themselves; coordination only consumes the registry
await ctx.plugin(CoordinationService, {})
```

挂载 coordination 后，委派给已注册的提供方并通过共享状态协调：

```ts
const workerId = await ctx.coordination.spawnWorker('spawn', {
  label: 'w1',
  prompt: [{ type: 'text', text: 'build the thing' }],
  parent,
  signal,
})
ctx.coordination.getWorker(workerId)   // → { status: 'completed', outcome: '...' }
ctx.coordination.postState('build', 'result', { ok: true })  // → { revision: 1 }
ctx.coordination.getState('build', 'result')                 // → { value: { ok: true }, ... }
```

## 配置（schemastery）

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 允许 `spawnWorker` / `postState`；为 `false` 时服务仍会注册，但两者都以 `coordination disabled` 拒绝 |
| `sqlite.path` | `string` | `':memory:'` | coordination 数据库文件路径 |

未知配置键在加载时被拒绝（`CoordinationConfig: unknown key "..."`）。

## 已知限制与暂缓事项

- 该服务消费 subagent 注册表且从不修改它：不注册、替换或移除任何提供方，提供方生命周期仍归拥有它们的包所有。某个提供方在 worker 运行期间注销时，该 worker 的行会自行结算。
- 目前还没有 `ctx.tools` 工具把 coordination 暴露给模型；可通过服务 API 或事件驱动。
- `spawnWorker` 在返回前会等待运行结算，因此长期运行的 worker 会阻塞调用方；一个在 worker 运行期间即返回的 fire-and-track 变体是可能的后续工作。

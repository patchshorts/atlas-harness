# @atlasai/atsh-router
[English](README.md) | 中文

DeepSeek Harness 的按能力（capability）门控的 LLM（大语言模型）路由：一个 `ctx.llmRouter` 服务，拦截 `llm/stream` Cordis waterfall（瀑布式事件），为与其能力配置路由不匹配的非冻结请求改写 `provider` / `model`，并把每次完成的调用记录到 SQLite 调用日志。配套的 `@atlasai/atsh-router-trainer` 包消费 `router/call-logged` 记录用于自动训练。

## 新增内容

- `ctx.llmRouter` —— `LlmRouter` 服务。将其作为插件加载；它在同一 Context 上注册 `llm/stream` waterfall 监听器（每个 Context 一个路由器）。
- 按能力门控的路由——每次调用被分类为 `options.purpose ?? 'general'`，并与 `config.routes[capability]` 匹配。
- 金律安全的改写——循环构建的请求以深度冻结状态到达，绝不会被修改：冻结的不匹配会记录 `route_state: 'advisory'`，调用完全按原请求发出。只有开启了 `applyRoutes` 的非冻结请求才会被就地改写。
- SQLite 调用日志——每次完成的调用都会写入 `call_log` 表（Node 内置的 `node:sqlite`；无 npm 依赖），并以 `router/call-logged` 事件发出。
- 公开接口：`routeFor(capability)`、`listCalls(limit?)`、`countCalls()`。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis'
import LlmRouter from '@atlasai/atsh-router'

const ctx = new Context()
await ctx.plugin(LlmRouter, {
  routes: {
    general: { provider: 'deepseek', model: 'deepseek-chat' },
    reasoning: { provider: 'deepseek', model: 'deepseek-reasoner' },
  },
})
```

挂载路由器后，同一 Context 上的每次 `ctx.llm.stream(...)` 调用都会被分类、路由并记录：

```ts
ctx.llmRouter.countCalls()          // → number of logged calls
ctx.llmRouter.listCalls(20)         // → newest 20 RouterCallRecords
ctx.llmRouter.routeFor('reasoning') // → { provider: 'deepseek', model: 'deepseek-reasoner' }
```

## 配置（schemastery）

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 拦截 `llm/stream` waterfall |
| `applyRoutes` | `boolean` | `true` | 改写非冻结的不匹配请求 |
| `routes` | `dict<{provider, model}>` | `{}` | 能力到路由的映射 |
| `sqlite.path` | `string` | `':memory:'` | 调用日志数据库文件路径 |

未知配置键会在加载时被拒绝（`RouterConfig: unknown key "..."`）。

## 模型体验

路由器从不触碰消息、系统提示词或内容块——它只为每次调用选择模型。路由决定哪个模型应答某个能力，因此 token 成本与 provider 特有行为随解析出的路由而定；改写路由会使任何以先前请求的 provider/model 对为键的 KV Cache 失效。建议性决策（冻结请求）保持请求的路由不变，并记录差距供后续调优。

## 已知限制与暂缓事项

- 路由仅按 `purpose` 进行能力门控——尚无按会话或按模型覆盖的机制，解析出的 provider 报错时也没有自动路由故障转移。
- 调用日志单调增长；目前没有随附的保留/淘汰策略。
- `route_state: 'none'`（未配置路由）仍会记录该调用——对可观测性有用，但也意味着日志会记录路由器并未路由的调用。
- 以附加方式加入冻结的上游克隆：注册 `ctx.llmRouter`、追加 `router/call-logged` 事件，不触碰任何现有包的源码。

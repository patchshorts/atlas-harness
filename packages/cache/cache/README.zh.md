# @atlasai/atsh-cache
[English](README.md) | 中文

DeepSeek Harness 的确定性 + 语义 LLM 响应缓存：`ctx.llmCache` 服务拦截 `llm/stream` Cordis 瀑布，无需上游调用即可提供缓存的完成结果，并在未命中时存储完整响应。精确层级对模型可见的请求子集（`provider`、`model`、`purpose`、`system`、`temperature`、`messages`、`tools`）计算规范 sha256 作为键；语义层级（默认关闭）回放一条嵌入得分达到或超过 `semanticThreshold` 的已存储完成结果以匹配请求。

## 新增内容

- `ctx.llmCache` —— `LlmCache` 服务。作为插件加载；它在同一 context 上注册 `llm/stream` 瀑布监听器（每个 context 一个缓存）。
- 精确层级 —— 字节完全相同的请求（相同的规范哈希）从已存储的 chunk 回放，`next()` 永远不会被调用：调用方收到的完成结果**不产生上游 LLM 命中**。
- 语义层级 —— 精确未命中时，将请求 embedding 与每条已存储 embedding 进行（余弦）比较；得分达到或超过 `semanticThreshold` 的最佳行作为近似匹配提供。默认关闭，因为向*不同的*提示词提供近似匹配会改变模型可见的内容。
- SQLite 后端 —— 行落入 `llm_cache` 表（Node 内置的 `node:sqlite`；无 npm 依赖），所属 fiber 卸载时关闭。
- 公共接口：`getStats()`，以及语义层级可替换的 `embedder` 属性。
- 事件：`cache/miss`（请求转发到上游，在流被消费前发出）与 `cache/hit`（存储的键 + 层级，`'exact'` 或 `'semantic'`）。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis'
import LlmCache from '@atlasai/atsh-cache'

const ctx = new Context()
await ctx.plugin(LlmCache, {})
```

挂载缓存后，同一 context 上的每次 `ctx.llm.stream(...)` 调用都会被拦截。完全相同的第二次调用由缓存提供：

```ts
ctx.llmCache.getStats() // → { entries, hits, misses, hitRate }
```

处理器只读取 `options`——深度冻结、由循环构建的请求绝不会被修改——上游流抛出异常时不存储任何内容（错误原样重新抛出）。

## 配置（schemastery）

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 拦截 `llm/stream` 瀑布 |
| `exact` | `boolean` | `true` | 从缓存提供字节完全相同的请求 |
| `semantic` | `boolean` | `false` | 通过 embedding 层级提供近似匹配 |
| `semanticThreshold` | `number` | `0.9` | 语义命中的最小余弦相似度 |
| `sqlite.path` | `string` | `':memory:'` | 缓存数据库文件路径 |

未知配置键在加载时被拒绝（`CacheConfig: unknown key "..."`）。

## 模型体验

缓存回放已存储的完成结果而非调用模型，这会改变 token 流向：命中**不产生任何上游 token**——请求永远不会到达提供方——调用方的 token 计量只看到回放的 chunk 流。后端日志是仅追加的：命中不会新增任何模型可见内容（没有消息、提示词或块），因此以请求前缀为键的 KV 缓存在整个回放期间保持有效——该缓存在构造上就是保留前缀缓存的。未命中的行为与未被拦截的调用完全一致，外加成功时存储一行。

## 已知限制与暂缓事项

- 语义层级默认关闭是一个刻意的门槛：向不同提示词提供近似匹配会改变模型可见内容，因此每次部署都必须显式启用。
- 默认 embedder 是一个确定性的本地词袋模型（固定 256 维计数向量，L2 归一化）——并非真正的 embedding 模型。生产部署通过公共的 `LlmCache.embedder` 属性换入真实模型；该替换是运行时赋值，不是配置键。
- 精确键覆盖固定的请求子集（`provider`、`model`、`purpose`、`system`、`temperature`、`messages`、`tools`）；`maxTokens`、`stop` 及其他生成旋钮不属于键的一部分，因此仅在这些字段上有差异的两个请求共享同一个缓存条目。
- 目前还没有驱逐、TTL 或按键失效；`llm_cache` 表单调增长。
- 以纯追加方式加入冻结的上游克隆：注册 `ctx.llmCache`、追加 `cache/hit` / `cache/miss` 事件，不触碰任何现有包源码。

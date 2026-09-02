# @atlasai/atsh-research
[English](README.md) | 中文

DeepSeek Harness 的外部研究 seam：一个 `ctx.research` 服务，通过 `xurl` CLI 搜索社交帖子，并通过 Atom API 搜索/获取 arXiv 论文。配套的 `@atlasai/atsh-tool-research` 包提供面向模型的 `xurl_search` / `arxiv_search` 工具。

## 新增内容

- `ctx.research` —— `ResearchService` 服务。将其作为插件加载；它在每个 Context 上注册一个服务（再次加载会抛出异常，这是 cordis 标准的重复服务行为）。
- `searchPosts(query, { limit })` —— 通过配置的 `xurlBin` 运行 `xurl search "<query>" -n <limit>`，解析 JSON stdout，并将帖子映射为 `ResearchPost` 记录。
- `searchPapers(query, { maxResults })` —— 查询 `${arxivBaseUrl}?search_query=all:<query>&max_results=<n>`，并仅用字符串提取解析 Atom 响应（无 XML 依赖）。
- `fetchPaper(id)` —— 按 id 列表获取一篇论文并返回第一个条目，未找到时返回 `null`。
- `getStats()` —— 按来源统计的计数器：`postsSearched`、`papersSearched`、`papersFetched` 和 `failures`。
- 事件：`research/posts-searched` 和 `research/papers-searched`，均为 `{ query, count }`，在每次成功搜索后发出。
- 禁用安全：当 `enabled: false`（或缺少 xurl 二进制文件，ENOENT）时，查询返回空结果，不抛异常，也不触碰 CLI 或网络。

## 配置（schemastery）

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 允许查询；为 `false` 时服务仍以 `ctx.research` 注册，但每次查询都会短路为空结果 |
| `xurlBin` | `string` | `'xurl'` | xurl CLI 二进制文件（除非是绝对路径，否则按 PATH 查找） |
| `arxivBaseUrl` | `string` | `'https://export.arxiv.org/api/query'` | arXiv Atom API 端点 |
| `maxResults` | `number` | `10` | 调用方省略该选项时的默认结果上限 |
| `fetchTimeoutMs` | `number` | `20000` | 每次 arXiv HTTP 请求的中止期限 |

## 用法

```ts
import { Context } from '@deepseek-ai/cordis'
import ResearchService from '@atlasai/atsh-research'

const ctx = new Context()
await ctx.plugin(ResearchService, {})
const posts = await ctx.research.searchPosts('attention is all you need', { limit: 5 })
const papers = await ctx.research.searchPapers('attention mechanisms', { maxResults: 3 })
ctx.research.getStats()   // → { postsSearched: 1, papersSearched: 1, papersFetched: 0, failures: 0 }
```

## 模型体验

查询是只读的外部请求：服务从不写入会话、KV Cache 或任何 registry，因此前缀缓存在多次查询之间保持有效。输出受 `maxResults` / `limit` 限制（默认每次调用 10 条记录），因此每次调用的 token 成本受返回记录约束——结果原样返回，不做 LLM（大语言模型）摘要、排序或改写。任何确定性输入都绝不会产生不同的输出：被禁用的服务（或缺少 xurl 二进制文件）退化为空结果而不是报错，使模型可见的约定保持全函数（total）。

## 已知限制与暂缓事项

- xurl 的 stdout 约定随构建而异；解析器容忍几种常见的字段拼写（数组或 `{ posts: [...] }`、`text`/`full_text`、`createdAt`/`created_at` 等），但特定构建仍可能需要 shim。
- Atom 解析仅做字符串提取：XML 实体不会被解码，格式错误的条目会被静默丢弃而不是上报。
- 没有分页、没有 PDF 全文获取，也没有 arXiv 限流管理——需要控制大批量研究节奏的调用方须自行限速。

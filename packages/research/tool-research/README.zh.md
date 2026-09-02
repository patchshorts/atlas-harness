# @atlasai/atsh-tool-research
[English](README.md) | 中文

面向模型的研究工具，基于 `ctx.research` seam：`xurl_search` 和 `arxiv_search`。

## 新增内容

- `xurl_search` —— 按查询搜索社交媒体帖子（必填 `query`，可选 `limit`）。返回匹配的帖子及其作者和互动指标。
- `arxiv_search` —— 按查询搜索 arXiv 论文（必填 `query`，可选 `maxResults`）。返回匹配的论文及其作者、发布日期、分类和 PDF 链接。

## 挂载

仅在 `tools` 与 `research` 同时组合时加载。与 `@atlasai/atsh-research`（或任何注册 `ctx.research` 的后端）一起挂载：

```ts
await ctx.plugin(ResearchService, {})
await ctx.plugin(ToolResearchPlugin, {})
```

当研究服务被禁用（`enabled: false`）时，工具仍会注册，但每次调用都返回空结果。

## 已知限制与暂缓事项

- 结果原样返回——除来源自身的排序外，没有去重或相关度排序。
- `xurl_search` 依赖已安装且在 PATH 中的 `xurl` CLI（或在服务上配置了 `xurlBin`）。

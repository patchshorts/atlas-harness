# @atlasai/atsh-tool-factory
[English](README.md) | 中文

基于 `ctx.factory` 的面向模型工厂工具：`bar_critic`（BAR 评判器 —
对照已注册的工厂计划契约任务为提交的工作打分）和
`contract_status`（列出工厂计划契约中
已注册的原子任务）。

## 安装

```bash
pnpm add @atlasai/atsh-tool-factory
```

## 工具

### bar_critic

使用确定性 BAR 评判器，将提交与已注册的工厂计划契约任务
进行对照打分。参数：`planId`、`taskId`、`summary`、`evidence`
（string[]）、`files`（string[]），可选 `blockers`（string[]）。
返回 `verdict` 对象（`taskId`、`status` PASS|FAIL|NOT_SUBMITTED、
`passedChecks`、`reasons`）。

### contract_status

列出工厂计划契约中已注册的原子任务。参数：
`planId`。返回 `{ planId, tasks }`，其中每个任务带有 `id`、`verb`、
`object` 和 `verifies`。

## 模型体验

- **模型可见面**：`bar_critic` 和 `contract_status` 工具。两者都是
  `ctx.factory` 之上的薄适配层；除工具 schema 本身外，
  不会添加任何提示词文本或 token。
- **Token**：除工具 schema 渲染外没有其他消耗。
- **KV 缓存**：无。

## 已知限制与暂缓事项

- `bar_critic` 的打分是来自
  `@atlasai/atsh-factory` 的确定性子句检查；它不执行
  也不验证提交的证据。
- `contract_status` 要求计划契约已在
  同一 context 上注册。

## 许可证

MIT

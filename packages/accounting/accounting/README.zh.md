# @atlasai/atsh-accounting
[English](README.md) | 中文

DeepSeek Harness 的 token 计量账本：`ctx.accounting` 服务从拦截到的 `llm/stream` 用量中借记账本行、记录信用授予，并在配置了按账户预算上限时，于分发之前在 `tools/execute` 边界否决工具调用。

## 新增内容

- `ctx.accounting` —— `AccountingService` 服务。作为插件加载；它在同一 context 上注册 `llm/stream`（借记）与 `tools/execute`（预算上限否决）瀑布监听器（每个 context 一个账本）。
- 账本 —— 每次报告用量的已完成的 llm 调用都会使用 token-meter 折叠公式追加一行 `debit`（负金额、`balance_after` 快照）：`inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens`。流本身绝不被改动——chunk 原样通过，错误原样重新抛出。
- 信用 —— `grant(amount, reason, account?)` 更新账户余额并追加一行 `grant`；`credits` 配置在挂载时为 `'default'` 账户注入初始额度（幂等——仅当账户不存在时生效）。
- 预算上限 —— 为账户配置 `budgets` 后，一旦该账户的借记总支出达到上限，工具调用即被否决：调用方收到 `isError` 结果，其中 `error.info.code === 'BUDGET_EXCEEDED'`，工具永远不会执行。没有上限条目的账户始终放行——计量对它们是被动的，因此标准 preset 保持安全。
- SQLite 后端 —— 行落入 `ledger` 与 `accounts` 表（Node 内置的 `node:sqlite`；无 npm 依赖），所属 fiber 卸载时关闭。
- 公共接口：`grant()`、`getBalance()`、`spendFor()`、`listLedger()`、`getStats()`。
- 事件：`accounting/debit`（已提交一行借记）与 `accounting/grant`（已提交一行信用授予），两者都携带 `{ account, amount, reason, balanceAfter }`。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis'
import AccountingService from '@atlasai/atsh-accounting'

const ctx = new Context()
await ctx.plugin(AccountingService, { credits: 10_000 })
```

挂载计量后，同一 context 上的每次 `ctx.llm.stream(...)` 调用都会被计量，每次 `ctx.tools.execute(...)` 调用都会受账户上限约束：

```ts
ctx.accounting.getBalance()   // → remaining tokens
ctx.accounting.getStats()     // → { grants, debits, accounts }
```

## 配置（schemastery）

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | 注册 `llm/stream` 与 `tools/execute` 监听器 |
| `credits` | `number` | `0` | 向 `'default'` 账户注入的初始额度（仅一次） |
| `budgets` | `Record<string, number>` | `{}` | 按账户的借记支出上限；无条目账户 = 永不被否决 |
| `sqlite.path` | `string` | `':memory:'` | 账本数据库文件路径 |

未知配置键在加载时被拒绝（`AccountingConfig: unknown key "..."`）。

## 已知限制与暂缓事项

- 借记在流结算时写入，即使调用在报告用量后出错——用量无论如何都已消耗，但一个感知错误的 `store-on-success-only` 模式（仿照 `dsh-cache`）是可能的后续工作。
- 目前还没有 `ctx.tools` 工具把账本暴露给模型；可通过服务 API 或事件读取。

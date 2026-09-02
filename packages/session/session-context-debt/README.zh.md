# @atlasai/atsh-session-context-debt

修复 11：上下文债务管理（`ctx.contextDebt`）——用检索代替堆砌（retrieval over
stuffing）、只折叠（fold-only）的压缩计划、位置放置（positional placement）——
关键上下文放在头部/尾部。该服务是对已提交会话事件的只读折叠：它从不修改会话
日志，因此任何 `scan` / `plan` / `report` / `reposition` 调用之后，JSONL 日志都
保持逐字节不变。

## 黄金规则

本包从不写入会话历史。每次操作都读取冻结的已提交快照（`session.events`）并返回
派生值。压缩计划天生是只折叠的——`CompactionPlan.foldOnly` 被硬类型化为
`true`：派生摘要遮蔽一段已提交的 seq，模型可见的历史只能通过折叠反映该摘要，
绝不会通过改写日志来实现。追加式（append-only）原则始终成立。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis'
import ContextDebtService from '@atlasai/atsh-session-context-debt'

const ctx = new Context()
await ctx.plugin(ContextDebtService, {
  stuffedThresholdTokens: 20000,
  positionalHeadTokens: 2000,
  positionalTailTokens: 2000,
})

const scan = ctx.contextDebt.scan(session)            // 债务报告 + foldSeq
const plan = ctx.contextDebt.plan(session, 4000)      // 只折叠压缩计划
ctx.contextDebt.report(plan)                          // 一行可观测性字符串
const { head, tail } = ctx.contextDebt.reposition(plan) // 关键头部/尾部区间
```

## 配置

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；为 `false` 时 `scan` / `plan` 抛出 `'context-debt disabled'`。 |
| `stuffedThresholdTokens` | `20000` | 累积的非必要上下文（工具结果、逐字日志）触发 `stuffed` 报告的阈值。 |
| `positionalHeadTokens` | `2000` | 关键头部区间的 token 预算。 |
| `positionalTailTokens` | `2000` | 关键尾部区间的 token 预算。 |

## 事件

| 事件 | 载荷 | 由谁发出 |
| --- | --- | --- |
| `context-debt/scan` | `ContextDebtScan` | `scan()` |
| `context-debt/plan` | `CompactionPlan` | `plan()` |

## 模型体验

- **模型调用：** 确定性核心零模型调用。`foldSummary` 是对已提交事件的纯文本
  折叠；基于模型的摘要折叠由调用方驱动——请自行携带预算调用 `foldSummary` /
  `plan`，绝不在服务内部调用。
- **Token：** 所有预算（`stuffedThresholdTokens`、`positionalHeadTokens`、
  `positionalTailTokens`、`plan` 的 `budgetTokens`）都由确定性的
  4 字符/token 启发式强制约束；派生摘要从不超过其预算。
- **KV 缓存：** 无影响——本包从不修改日志，因此前缀缓存不受任何操作影响。

## 已知限制与待办工作

- `reposition` 返回头部/尾部区间的行数组；从这些区间组装模型可见上下文的实际
  工作由调用方完成。
- `unretrieved` 债务是一个计划级信号：本包报告债务并生成只折叠计划，但在决策
  点触发重新检索的逻辑必须由调用方接入。

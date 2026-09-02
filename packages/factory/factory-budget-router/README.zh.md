# @atlasai/atsh-factory-budget-router

[English](README.md) | 中文

针对 harness 的 Fix 2 令牌预算 + Fix 9 路由（`ctx.budgetRouter`）：在
`llm/stream` 边界强制硬性令牌预算（超预算调用在适配器运行前即以
`BUDGET_EXCEEDED` 被否决）、按阶段进行基于累积成本条件的模型路由（阶梯
泳道，档次随累积花费变化）、对共享系统提示词的批量提示（batch prompting），
以及成本与通过率一起报告。

金规则保持不变：服务绝不写入 `options.messages` 或 `options.system`。路由
决策只改写非冻结请求上的 `provider`/`model` 元数据，因此请求前缀在各阶段
之间保持逐字节一致（保留前缀缓存友好历史 —— pro 模型缓存读取定价
$0.0033/M，未缓存 $0.435/M，131.8 倍差距）。

## 安装

```bash
pnpm add @atlasai/atsh-factory-budget-router
```

## 用法

```ts
import { Context } from '@deepseek-ai/cordis'
import BudgetRouterService from '@atlasai/atsh-factory-budget-router'

const ctx = new Context()
await ctx.plugin(BudgetRouterService, {
  budgets: { default: 1_000_000 },
  stageRoutes: {
    general: [
      { provider: 'deepseek', model: 'pro', maxCumulativeCost: 500_000 },
      { provider: 'deepseek', model: 'cheap', maxCumulativeCost: undefined },
    ],
  },
})

// 读取账户的花费/预算/剩余快照
const state = ctx.budgetRouter.budgetState('default')

// 在累积成本下解析阶段的成本条件路由
const route = ctx.budgetRouter.routeForStage('general', 600_000) // cheap 档

// 按共享系统提示词规划批次（分组 + 预估缓存读取节省）
const plan = ctx.budgetRouter.planBatches([{ system: 'S', messages: [] }, { system: 'S', messages: [] }])

// 为一次用量记录定价，并将成本与通过率一起报告
const cost = ctx.budgetRouter.price({ inputTokens: 1_000_000, outputTokens: 0 }) // 0.435
const report = ctx.budgetRouter.reportCostAndPassRate([{ id: 'a', costUsd: 0.435, pass: true }])
```

## 配置

| key | 类型 | 默认值 | 描述 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关；为 `false` 时服务完全被动（不否决、不改写、不发事件）。 |
| `budgets` | Record\<string, number\> | `{}` | 账户 -> 令牌上限。账户花费达到上限的 `llm/stream` 调用以 `BUDGET_EXCEEDED` 被否决。 |
| `stageRoutes` | Record\<string, StageRoute[]\> | `{}` | 阶段（'general' 等）-> 阶梯泳道，按 `maxCumulativeCost` 升序。首个满足 `undefined` 或 `>=` 累积成本的档位生效；花费超过所有上限后，最后一档（最便宜的无限档）生效。 |
| `modelCost` | Partial\<ModelCost\> | `{}` | 覆盖固定的 DeepSeek pro 常量（`input` $0.435/M、`cacheRead` $0.0033/M；`output`/`cacheWrite` 在提供方目录就绪前定价 0）。 |
| `batchPrompting` | boolean | `true` | 将共享相同系统提示词的请求分组成批次计划。 |
| `applyRoutes` | boolean | `true` | 改写非冻结路由不匹配；冻结请求始终降级为 advisory（绝不改写）。 |

## 模型体验

- **模型可见表面**：`ctx.budgetRouter` —— `budgetState`、`routeForStage`、
  `planBatches`、`price`、`reportCostAndPassRate`、`cacheRatio`。纯路由与
  批量规划函数（`selectTier`、`routeForStage`、`matchRoute`、
  `estimateSystemTokens`、`planBatches`）同样导出，供调用方自行组装批次。
- **令牌**：确定性核心为零 —— 本包不发起任何模型调用。批量规划只返回
  分组；实际请求组装由调用方接线。
- **KV 缓存**：无。预算强制通过 `ctx.get` 读取 accounting 账本（可选）；
  服务自身不持有任何花费状态，也无 KV 缓存或持久化存储效应。

## 事件

- `budget/veto`（`BudgetVetoRecord`）—— 硬性预算否决阻止了一次
  `llm/stream` 调用：账户花费达到配置预算，调用在适配器运行前以
  `BUDGET_EXCEEDED` 被拒绝。
- `budget/route`（`BudgetRouteDecision`）—— 一次 `llm/stream` 调用以成本
  条件路由决策收尾（账户、阶段、累积成本、请求与解析后的 provider/model、
  路由状态）。

## 已知限制与待办工作

- 预算强制依赖 `@atlasai/atsh-accounting` 挂载：花费通过
  `ctx.get('accounting')` 读取，未挂载 accounting 时服务为被动状态
  （花费读为 0，不否决）。
- `output`/`cacheWrite` 定价暂时固定为 0，待提供方目录就绪（RECON 缺口，
  2026-08-17）；固定的一对是 input $0.435/M 对 `cacheRead` $0.0033/M，
  `cacheRatio()` 将 131.8 倍差距变为可计算、可测试的数字。
- 批量规划只返回分组与预估缓存读取节省 —— 实际请求组装（将多个调用合并
  为一个请求）由调用方接线。
- 金规则：服务绝不触碰 `options.messages`/`options.system` —— 路由决策
  只改写非冻结请求上的 `provider`/`model` 元数据（仅追加、保持不变）。

## 许可证

MIT

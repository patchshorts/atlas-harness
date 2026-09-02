# @atlasai/atsh-judge-gate

[English](README.md) | 中文

在 SAD 规定的三个时刻强制执行 Pass 4 三人评审小组（`ctx.judgeGate`）：计划准入、任务完成与退出评审。该门卫将提交的计划解析为原子任务，提交给既有的 `ctx.factoryJudge` 评审小组（三个独立角色，须全票通过），并采用失败关闭（fail-closed）语义——被拒绝的计划或声明会抛出携带裁决与全部投票理由的 `JudgeGateError`，使模型能够依据精确引用产物的反馈进行修订。门卫是接缝而非第二个评审者：它不持有任何投票状态，也不新增事件；投票与裁决沿用既有的 `judge/*` 事件流。

门卫绝不触碰会话日志、消息历史或投影——仅处理计划产物（金律）。

## 安装

```bash
pnpm add @atlasai/atsh-judge-gate
```

## 用法

```ts
import { Context } from '@deepseek-ai/cordis'
import JudgeGateService from '@atlasai/atsh-judge-gate'

const ctx = new Context()
await ctx.plugin(JudgeGateService, { enabled: true, maxReplans: 2 })

// 计划准入：未通过时抛出 JudgeGateError（含投票理由）
try {
  ctx.judgeGate.admitPlan({
    planId: 'session-1:plan',
    revision: 'r1',
    planMarkdown: '1. [fix] everything — verifies: ',
  })
} catch (error) {
  // error.verdict.verdict === 'REPLAN' | 'ESCALATE'; error.reasons 引用产物
}

// 任务完成 / 退出评审：默认要求该计划 id 此前已获批准
const verdict = ctx.judgeGate.checkCompletion({
  planId: 'session-1:plan',
  revision: 'r1',
  submission: { summary: 'auth module implemented', evidence: ['tests pass'], files: ['src/auth.ts'] },
})

// 纯解析器，供测试导出：相同 markdown → 相同任务
import { parsePlanTasks } from '@atlasai/atsh-judge-gate'
const tasks = parsePlanTasks('1. [implement] the auth module — verifies: login() exists')
```

## 配置

| key | type | default | description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 门卫是否接受评审请求。 |
| `maxReplans` | number | `2` | 每次评审允许的最大重规划次数，超过即升级（D2: N≤2）。由门卫针对评审小组的重规划计数器的预算预检强制执行；评审小组自身的默认预算（3）在门卫所辖时刻不会超过此值。 |
| `requirePlanApproval` | boolean | `true` | 完成/退出投票要求该计划 id 此前已获批准。 |

## 模型体验

- **模型可见面**：`ctx.judgeGate` — `admitPlan`、`checkCompletion`、
  `reviewExit`、`parsePlanTasks`。拒绝以携带 `JudgeGateError` 字段
  （`verdict`、`reasons`、`tasks`）的工具错误呈现——无额外 UI 词汇。
- **Token**：门卫本身为零——零模型调用。评审小组的重规划费用（如有）由
  评审服务照旧写入会计。
- **KV 缓存**：无。门卫的准入登记表（planId → 已准入版本 + 解析任务，
  完成/退出投票所需）位于内存，随其上下文销毁；小组的投票与重规划状态
  位于 `ctx.factoryJudge`，随其上下文销毁。

## 事件

门卫不新增事件。投票、重规划与裁决沿用 `ctx.factoryJudge` 发出的既有
`judge/*` 事件流（`judge/ballot`、`judge/replan`、`judge/verdict`）。

## 已知限制与延后工作

- `requirePlanApproval: false` 仅关闭门卫自身的准入预检；评审小组的批准
  要求（factoryJudge 只读）对 kind 'completion' 仍然生效，且未准入的计划
  没有可供小组评审的解析任务。
- 计划准入仅在组合装载了本包时才接入 `plan-mode`：钩子通过
  `ctx.get('judgeGate')` 解析，缺失时跳过（保持现状）。不含 factory 包的
  组合行为不变。
- 完成与退出评审时刻尚无在运行的 harness 调用方：factory 循环在 SAD
  规定的时刻调用它们，本包通过直接服务测试证明两个表面。挂载了门卫但未
  挂载评审小组的组合会在调用时失败关闭（`factoryJudge` 缺失）。
- 解析器接受 factory L5 行格式与 `N. [verb] object — verifies: check`
  形式；其他计划方言逐行跳过，由分解投票标记缺口。

## 许可证

MIT

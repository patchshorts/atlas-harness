# @atlasai/atsh-factory-judge

[English](README.md) | 中文

面向 harness 的 Pass 4 一致三面板评审（`ctx.factoryJudge`）：计划、失败
分类和完成判定的事前提交（pre-commit）门禁。三个独立的面板角色 ——
分解（decomposition）、可行性（feasibility）、验证（verification）——
对计划工件投出 YES 或 NO；任何一个 NO 都是异议（dissent），而不是平均。
异议触发有界重计划循环（计入 accounting 成本），重计划耗尽后升级
（escalate）给调用方。每个选票与判定都通过事件流发出。

评审器绝不接触会话日志、消息历史或投影（projections）。它只处理计划工件
（金规则 —— 仅追加、保持不变）。

## 安装

```bash
pnpm add @atlasai/atsh-factory-judge
```

## 用法

```ts
import { Context } from '@deepseek-ai/cordis'
import JudgeService from '@atlasai/atsh-factory-judge'

const ctx = new Context()
await ctx.plugin(JudgeService, { enabled: true, maxReplans: 3, replanCost: 1500 })

// 用完整三角色面板评审一个计划
const verdict = ctx.factoryJudge.judge({
  judgmentId: 'j1',
  planId: 'plan-1',
  revision: 'r1',
  kind: 'plan',
  tasks: [
    { id: 't1', verb: 'implement', object: 'the auth module', verifies: 'auth module exposes login()' },
  ],
})
// 只有当三个角色全部投 YES 时 verdict.verdict 才是 'PASS'

// 对先前获批的计划工件做完成门禁
const completion = ctx.factoryJudge.judge({
  judgmentId: 'j2',
  planId: 'plan-1',
  revision: 'r1',
  kind: 'completion',
  tasks: [{ id: 't1', verb: 'implement', object: 'the auth module', verifies: 'auth module exposes login()' }],
  submission: { summary: 'auth module implemented', evidence: ['tests pass'], files: ['src/auth.ts'] },
})

// 读取重计划预算，或重置它
ctx.factoryJudge.replanState('j1')
ctx.factoryJudge.resetJudgment('j1')
```

## 配置

| key | type | default | description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 是否接受判定。禁用时读操作（`isPlanApproved`、`replanState`、`resetJudgment`）仍可用。 |
| `maxReplans` | number | `3` | 每次判定在升级前的最大重计划次数。 |
| `replanCost` | number | `1500` | 每次重计划的 token 费用，以 `judge-replan` 借记写入 accounting。 |

## 模型体验

- **模型可见面**：`ctx.factoryJudge` —— `judge`、`isPlanApproved`、
  `replanState`、`resetJudgment`。三个角色章程以纯函数
  `judgeRoleObjective(role, kind)` 暴露。
- **Tokens**：确定性核心为零 —— 本包不发起任何模型调用。模型驱动的评审
  由调用方通过 `judgeRoleObjective` 驱动，每个角色使用全新上下文
  （fresh context）。
- **KV 缓存**：无。选票与重计划状态是绑定上下文 fiber 的内存 `Map`；
  无 KV 缓存或持久化存储副作用。

## 事件

- `judge/ballot`（`JudgeVote`）——某个角色为一次判定投出一票。
- `judge/replan`（`{ judgmentId, planId, kind, round, cost }`）——异议且
  重计划预算仍有剩余时，授予一次重计划。
- `judge/verdict`（`JudgeVerdict`）——一轮判定结案（PASS / REPLAN /
  ESCALATE），附该轮全部选票。

## 已知限制与延期工作

- 升级策略（stakes 阈值、单评审默认）属于调用方的接线，而非本服务：
  ESCALATE 将判定交还调用方且不再重计划，由调用方决定 stakes 的含义。
- 模型驱动的可行性与验证投票由调用方驱动：确定性核心只评审工件结构，
  调用方可通过 `judgeRoleObjective` 运行模型评审并合并其选票。
- 每个评审的全新上下文是确定性引擎的保证（选票仅由请求 + 章程计算）；
  服务在角色之间不共享任何选票状态。
- 金规则：评审器绝不接触会话日志、消息历史或投影 —— 只处理计划工件
  （仅追加、保持不变）。

## License

MIT

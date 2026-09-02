# @atlasai/atsh-factory
[English](README.md) | 中文

面向 harness 的工厂角色工作流（`ctx.factory`）：一个计划契约注册表、
对提交的工作进行确定性 BAR 评判打分，以及 planner /
developer / critic 角色目标构建器，它们生成不可变的
`objective` 输入供 ralph 工具使用。

## 安装

```bash
pnpm add @atlasai/atsh-factory
```

## 用法

```ts
import { Context } from '@deepseek-ai/cordis'
import FactoryService from '@atlasai/atsh-factory'

const ctx = new Context()
await ctx.plugin(FactoryService, { enabled: true, maxPlanTasks: 100 })

// 1. register a plan contract
ctx.factory.registerPlanContract('plan-1', [
  {
    id: 't1',
    verb: 'implement',
    object: 'the auth module',
    verifies: 'auth module exposes login()',
  },
])

// 2. score a submission with the deterministic BAR judge
const verdict = ctx.factory.scoreTask('plan-1', {
  taskId: 't1',
  summary: 'implemented the auth module',
  evidence: ['unit tests pass'],
  files: ['src/auth.ts'],
})

// 3. build role objectives for the ralph tool
const objective = ctx.factory.buildRoleObjective('planner', {
  scope: 'build the factory capability',
})
```

## 配置

| 键 | 类型 | 默认值 | 描述 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 接受计划契约注册。禁用后，读取（`getPlanContract`、`listPlanIds`）与打分仍然可用。 |
| `maxPlanTasks` | number | `100` | 单个计划契约可包含的原子任务的最大数量。 |

## 模型体验

- **模型可见面**：`ctx.factory` — `registerPlanContract`、
  `getPlanContract`、`listPlanIds`、`scoreTask`、`scoreContract`、
  `buildRoleObjective`。构建器产出的角色目标是纯确定性字符串，
  用作 ralph 工具唯一不可变的
  `objective` 输入。
- **Token**：无。本包不发起任何 LLM 调用，也从不向任何提示词
  贡献 token。
- **KV 缓存**：无。契约注册表是限定在 context fiber 内的内存 `Map`；
  没有 KV 缓存或持久化存储影响。

## 事件

- `factory/contract-registered`（`{ planId: string; count: number }`）—
  计划契约注册或被替换后发出。

## 已知限制与暂缓事项

- 打分是确定性的子句检查（summary、evidence、files）；它不执行所声称
  的工作，也不验证证据内容。
- `scoreContract` 每个任务 id 只对第一份提交打分；
  同一任务的重复提交会被忽略。
- 注册表是 context 级内存；目前还没有计划契约的
  跨会话持久化。

## 许可证

MIT

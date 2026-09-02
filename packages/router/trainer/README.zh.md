# @atlasai/atsh-router-trainer
[English](README.md) | 中文

`@atlasai/atsh-router` 的自动训练消费方：一个把每条 `router/call-logged` 记录收集进 `ctx.routerTrainer` 以供下游训练的服务，带一个可选的 JSONL 输出端。训练器也会把纠正奖励穿针到被纠正的调用上：一条纠正会被当作该路由决策产生的负向奖励信号来消费。服务包——默认导出 `RouterTrainer` 服务类（注册为 `ctx.routerTrainer`），镜像 `ctx.memoryStore` seam。

## 新增内容

- `ctx.routerTrainer` —— `RouterTrainer` 服务：`count()`、`records()`、`reset()`、`onCall(record)`、`recordCorrection(correction)`、`rewards()` 和 `corrections()`。
- 可选的 `outputPath` —— 为每次被记录的调用以及每条穿针的纠正各追加一行 JSONL（自动创建父目录，权限 `0o700`），供离线训练流水线使用。
- 纠正奖励通道 —— `recordCorrection(correction)` 把一条纠正当作奖励来消费：把纠正追加到同一个 JSONL 日志，按 `callId` 附加到匹配的被记录调用上，并且无论该调用是否已知都会记录下来。

## 用法

```ts
import { Context } from '@deepseek-ai/cordis'
import Router from '@atlasai/atsh-router'
import RouterTrainer from '@atlasai/atsh-router-trainer'

const ctx = new Context()
await ctx.plugin(Router, {
  routes: { general: { provider: 'deepseek', model: 'deepseek-chat' } },
})
await ctx.plugin(RouterTrainer, { outputPath: './calls.jsonl' })

// after some routed calls:
ctx.routerTrainer.count()    // → samples collected
ctx.routerTrainer.records()  // → the samples, in arrival order

// a correction fired on call '<callId>' (e.g. a retried failed tool):
ctx.routerTrainer.recordCorrection({
  id: 'corr-1',
  callId,                    // the RouterCallRecord.id that was corrected
  ts: Date.now(),
  classification: 'C1',
  note: 'retried failed tool',
})

ctx.routerTrainer.corrections() // → [the consumed correction records]
ctx.routerTrainer.rewards()     // → the samples that carry a correction reward
ctx.routerTrainer.reset()       // → drop samples and corrections
```

## 配置（schemastery）

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `outputPath` | `string` | — | 每次调用与每条纠正各向该文件追加一行 JSONL |

## 模型体验

训练器从不改变模型看到的内容，也不改变由哪个模型应答：它是路由器调用日志的事后消费方。记录携带解析出的 provider/model、能力、route state、status、分片数和时长——足以在不重放对话的情况下训练路由策略。纠正同样是事后信号：它们把一次调用的路由决策标记为值得惩罚，并且绝不进入模型可见的 prompt 或工具流。

## 已知限制与暂缓事项

- 插件 fiber 卸载时，内存中的样本与纠正会丢失；只有 `outputPath` 会持久保存。
- 目前没有随附的批处理、去重或标签生成——样本是原始的 `RouterCallRecord` 值，外加一个可选的穿针 `reward`。
- `reset()` 会清空样本与纠正队列，但不会截断 `outputPath` 文件。
- 以附加方式加入：注册 `ctx.routerTrainer`、订阅路由器的 `router/call-logged` 事件，不触碰任何现有包的源码。
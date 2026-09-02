# @atlasai/atsh-factory-observability

修复 3/6/7 可观测性与验证器正确性（`ctx.observability`）：每一步都以结构化
事件记录；只追加（append-only）的事件流是事实来源。预测性失败信号——规划
占比（P-Ratio）、Plan-Explore-Plan 螺旋、E→V 缺口、重复相同调用——都在该
事件流之上派生。完成（completion）由确定性验证器裁决，并在负例夹具上验证
（TNR 闸门）。replay-with-patch 是调试基座：错误暴露的步骤未必是原因步骤。
本包绝不改写会话日志或消息历史——每一次通道都返回新的派生值（金规 golden
rule）。

## 模型体验（Model Experience）

- **确定性核心零模型调用。** `computeMetrics()`、`evaluateSignals()`、
  `verifyCompletion()`、`replayWithPatch()` 均为纯确定性函数——无 LLM、
  无网络、无 token 开销。阶段分类是固定的 kind 映射，而非模型通道。
- **Token 影响。** 本包自身无影响。服务持有内存环形缓冲区（派生投影，
  绝非会话日志）；本包不向上下文增加 token，也不改写投影。
- **KV 缓存影响。** 无。本包不持有任何模型可见状态，绝不写入消息历史。

## 安装与挂载

```ts
import ObservabilityService from '@atlasai/atsh-factory-observability'

ctx.plugin(ObservabilityService, {
  enabled: true,          // 默认
  windowSize: 512,        // 环形缓冲区上限
  pRatioAlarm: 0.5,       // 规划占比告警阈值
  evDeficitWarn: 0.1,     // verify/(evaluate+verify) 预警阈值
  repeatThreshold: 3,     // 重复相同调用告警阈值
})
```

启用时，服务通过 `ctx.on` 订阅七个已知 harness 事件 kind（`judge/ballot`、
`judge/verdict`、`judge/replan`、`budget/route`、`budget/veto`、`lane/veto`、
`factory/contract-registered`），将每个事件写入环形缓冲区（载荷带有
`account`/`name`/`stage`/`tool` 时提取其中一项作为简短 detail）。禁用时
服务为被动模式：不注册订阅，缓冲区方法抛出 `observability disabled`，
验证器方法仍然可用（纯过滤器，如同 lane-guard 的 sanitize）。

## 配置

| key | 类型 | 默认值 | 说明 |
| --- | ---- | ------ | ---- |
| `enabled` | `boolean` | `true` | 为 false 时服务被动：不注册 harness 事件订阅；`record`/`report`/`signalAt`/`reset` 抛出 `observability disabled`；`verifyCompletion`/`validateVerifier` 仍可用 |
| `windowSize` | `number` | `512` | 环形缓冲区上限；最旧的事件先被丢弃（窗口内保持只追加语义） |
| `pRatioAlarm` | `number` | `0.5` | 规划占比告警阈值：`plan / total` 超过该值时触发 `high-p-ratio` |
| `evDeficitWarn` | `number` | `0.1` | E→V 预警阈值：`verify / (evaluate + verify)` 低于该值时触发 `e-to-v-deficit` |
| `repeatThreshold` | `number` | `3` | 重复相同调用告警阈值：连续 `>= N` 个相同 `(kind, detail)` 事件触发 `repeated-identical-calls` |

## 事件

| 事件 | 载荷 | 说明 |
| ---- | ---- | ---- |
| `observability/report` | `SignalReport` | 当前的信号报告（指标、触发信号、结论），仅在信号 id 自上次发射以来发生变化时发射（去重） |

## 五个信号

| 信号 | 严重度 | 条件 | 经验依据 |
| ---- | ------ | ---- | ------- |
| `high-p-ratio` | alarm | `pRatio > 0.5` | P-Ratio r=-0.256——相对执行而言规划越多越预示失败 |
| `e-to-v-deficit` | warn | `eToV < 0.1` | E→V 2.1%——verify 转换相对于 evaluate 极为罕见 |
| `plan-explore-plan-spiral` | alarm | `pxpSpirals > 0` | P-X-P 三元组是具体的运行时告警：规划与探索之间的循环 |
| `repeated-identical-calls` | alarm | `maxRepeatRun >= 3` | 重复相同调用是死循环的标志 |
| TNR 闸门（验证器） | 闸门 | 负例夹具上 `tnr >= 0.8` | TNR 问题对闸门而言生死攸关：LLM 评委几乎全盘接受（TNR <25% vs TPR >96%），因此验证器必须在负例上验证，否则就是在给垃圾背书 |

## Replay-with-patch

`signalAt(index, event)` 用替换一个事件的方式重放缓冲事件流，并报告哪些
信号发生了变化——把静默失败归因到其原因步骤，而非暴露步骤：

```ts
const result = ctx.observability.signalAt(4, {
  ts: 4, stage: 'evaluate', kind: 'judge/ballot', detail: 'patched',
})
// result.before   — 对已记录事件流的报告
// result.after    — 将下标 4 替换为补丁后的报告
// result.changed  — 触发状态发生变化的信号 id（已排序）
```

输入事件流绝不被修改（打补丁的事件流是一个新数组）；下标越界抛出
`RangeError`。

## 已知限制与后续工作（Known Limitations and Deferred Work）

- **仅内存窗口——无持久化。** 环形缓冲区随上下文 fiber 作用域存在，dispose
  时丢弃。harness 必须调用 `record()` 喂入事件；本包证明基座，事件接入由
  调用方负责。
- **信号阈值只是默认值，可由操作者调优。** 经验依据（P-Ratio r=-0.256、
  E→V 2.1%）给出合理默认值；操作者可按挂载覆盖 `pRatioAlarm`、
  `evDeficitWarn`、`repeatThreshold`。
- **阶段分类是确定性的 kind 映射，而非模型通道。** 映射之外的 kind 不分类、
  不计入指标；更丰富的分类器属于模型通道，不在本包范围内。
- **缓冲区是派生投影，不是会话日志。** 需要持久、可查询历史的消费者必须
  自行持久化事件。

## 金规（Golden rule）

绝不写入会话日志或消息历史——只追加持有。事件按值复制进环形缓冲区（绝不
按引用保留），每一次通道都返回新的派生值，输入保持逐字节不变（由本包测试
断言）。

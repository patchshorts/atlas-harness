# dsh-runtime-alarms

[English](README.md) | 中文

对 DeepSeek Harness 运行时事件流进行折叠并返回派生信号的 alarm 检测器：P-Ratio 效率崩溃、证据到结论（evidence-to-verdict）赤字和重复调用循环。检测器是纯函数 —— 它们读取可重放事件投影，绝不修改流或模型可见历史（黄金法则）。

## 设计姿态

黄金法则依然成立：检测器是诊断投影。它们每次传递对事件流（`@atlasai/atsh-runtime-events`）折叠一次并返回 alarm 对象。没有检测器会写流、修改事件或触碰消息历史。底层流中的单调 `seq` 游标已防止重复消费；每个检测器额外采用单趟传递，因此事件在一次折叠内绝不会被计数两次。

## 检测器

| 检测器 | 条件 | 选项 |
|---|---|---|
| `detectPRatio` | 模型调用窗口内 output/(input+output) 低于 `minOutputFraction`（默认 0.15） | `minOutputFraction` |
| `detectEvidenceDeficit` | 评审投票携带的证据短于 `minEvidenceChars`（默认 1） | `minEvidenceChars` |
| `detectRepeatedCalls` | 同一工具在一次运行中被调用 `repeatThreshold`（默认 3）次 | `repeatThreshold`、`strictConsecutive` |

`detectAlarms(events, opts)` 按稳定顺序运行全部三个检测器，并将每个 alarm 作为输入的全新投影返回。

## 开发

`tests/` 中的自目标测试（vitest）。行为通过确定性合成流验证；没有 full-bench 要求（D11 指示）。无生产部署、无回滚逃生舱门（rollback escape hatch）的姿态与父计划 the prior workstream 一致（变更是增量的；回退即删除目录）。

## Model Experience

无。告警检测器是诊断折叠，它们从不改动提示词、消息、schema、流或工具结果。

#### KV Cache effect

无；检测器不会组装任何提供方请求。

## Known Limitations and Deferred Work

- 检测器是同步的单趟折叠。随着事件落地而增量发出 alarm 的持久/流式检测器是未来的增强；当前形态适合事件包的可重放内存折叠。
- 阈值是每次调用静态的；运行时自适应阈值尚未实现。

# dsh-runtime-events

[English](README.md) | 中文

DeepSeek Harness 运行时信号的类型化、可重放诊断事件流：工具调用、模型调用、评审投票、预算状态和压缩（compaction）。Alarms（P-Ratio、E→V 赤字、重复调用）和 verifier 使用该流的可重放折叠结果做出经过验证的操作决策。

## 设计姿态

黄金法则依然成立：该流是日志经纯函数折叠得出的诊断 PROJECTION（投影）。它永远不会修改模型可见历史；深度冻结的投影在变更时会抛出异常。该流在会话折叠内只能追加。

## 开发

`tests/` 中的自目标测试（vitest）。没有 full-bench 要求：事件和 alarm 行为通过确定性的合成流加以验证。

## Model Experience

无。事件流是一个诊断投影，它从不改动提示词、消息、schema、流或工具结果。

#### KV Cache effect

无；事件流不会组装任何提供方请求。

## Known Limitations and Deferred Work

- 事件流的持久化目前尚无任何消费者要求；可重放折叠在内存中覆盖读取路径。在下一次消费者提出需求时重新提上议程。
- 类型化事件种类和只追加的可重放流核心在 `src/types.ts` + `src/stream.ts` 中实现（append、snapshot、freeze、纯折叠、replay）。alarm 检测器和加固后的 verifier 位于该诊断组的兄弟包中。

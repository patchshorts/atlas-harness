# dsh-runtime-verifiers

[English](README.md) | 中文

面向 DeepSeek Harness 的加固版 verifier 正确性。它将 verifier 的判断与带标签的 fixture 电池一一评估 —— 已知正确和已知错误的输入 —— 并拒绝一律通过的评审（D7 Fix 6/7）。接受一切的 verifier 会把不受信任的穷尽结果变成虚假的正确性印章；true-negative-rate（真阴性率）守卫会捕获它，truth gate 会拒绝携带无证据的裸 `pass` 选票。

## 设计姿态

黄金法则依然成立：评估是对 verifier 选票的纯折叠。该模块绝不修改 verifier、fixture、选票或任何事件，也绝不写模型可见历史。返回的报告是一个全新投影。

## API

| 符号 | 用途 |
|---|---|
| `evaluateVerifier(verifier, fixtures, opts)` | 在带标签的 fixture 上运行 verifier；返回 `VerifierReport`（判定 pass/fail/unvalidated + 混淆矩阵计数 + 真阴性率）。 |
| `truthGate(ballot, opts)` | 门控一个选票：`pass` 必须携带 ≥ `minEvidenceChars` 的证据。 |
| `isFalsePositive(fixture, ballot)` | 严格检查：对带标签 NEGATIVE 的 `pass` 即是一律通过之债。 |
| `UNVALIDATED` | 当电池不包含阴性 fixture（守卫无法运行）时返回的报告。 |

默认值：`MIN_TRUE_NEGATIVE_RATE = 0.25`、`MIN_EVIDENCE_CHARS = 1`。

- TNR 守卫：当存在带标签的阴性且拒绝率低于 `minTrueNegativeRate` 时，verifier 被拒绝为一律通过之债。没有阴性的电池产生 `unvalidated`（调用方必须提供阴性）。
- Replan 计为一次拒绝（绝非 pass），符合三面板约定：单个 NO 返回 replan，而非 pass。

## 开发

`tests/` 中的自目标测试（vitest）。阴性 fixture 套件为每个 verifier 携带 ≥5 个不同的 NEGATIVE fixture，外加一个全通过者拒绝用例（D7）。没有 full-bench 要求（D11 指示）。增量包：无生产部署、无回滚逃生舱门 —— 回退即删除目录。

## Model Experience

无。验证器评估是对带标签固定数据的纯折叠，它从不改动提示词、消息或工具结果。

#### KV Cache effect

无；验证器评估不会组装任何提供方请求。

## Known Limitations and Deferred Work

- T 检测是分类式的，而非校准式：例如，恰好产生 26% TNR、接近下限的 verifier 会被接受；只有低于下限的崩溃才会失败。校准分级/置信度标度是未来的增强。
- 守卫衡量的是离散的 fixture 电池。在线/流式 TNR 自适应（针对新观察到的阴性重新测量）尚未实现。

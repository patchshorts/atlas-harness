# @atlasai/atsh-bench

[English](README.md) | 中文

DeepSeek Harness 的基准测试家族：基于追加式会话日志的确定性「每次会话修正数」基准（the bench workstream）。修正数由确定性规则统计——不引入 LLM 判断——覆盖五个类别（C1 重试失败的工具调用、C2 还原的文件编辑、C3 自我修正消息、C4 修复的计划偏离、C5 用户修正），两个臂（原生克隆 vs 增强型 harness）在同一任务集上运行并得出配对统计结论。

## 状态

分类器（`bench-classify`）已完成并通过单元测试。运行器（`bench-run`）与报告器（`bench-report`）模块由后续 the bench workstream 基准循环任务添加。

## 用法

该接缝作为 Cordis 服务挂载：

```ts
import { Context } from '@deepseek-ai/cordis'
import BenchService from '@atlasai/atsh-bench'

const ctx = new Context()
await ctx.plugin(BenchService, {})
```

## bench-classify

`classifySession(events, config?)` 统计一份导出的会话日志中的 C1..C5 修正数。输入为 harness 的 `SessionEvent` 信封，以 JSON 导出并保留 `type` 与 `seq`——可以是裸事件数组或 `{ sessionId, events }`：

```ts
import { classifySession, loadEvents } from '@atlasai/atsh-bench'

const events = loadEvents(sessionLogJson)
const result = classifySession(events)
// { C1: 1, C2: 0, C3: 1, C4: 0, C5: 1 }, total: 3, per100Calls: 12.5,
//   hits: [{ class: 'C1', seq: 9, note: '...' }, ...] }
```

五条规则（基准规范 §2.1，全部基于日志、确定性）：

| 类别 | 规则 |
| --- | --- |
| C1 重试失败的工具调用 | 携带 `error` 的 `tool/result` 之后 4 个事件内出现同名 `tool/call` |
| C2 还原的文件编辑 | fs 家族写入的内容哈希与同一路径更早写入的内容哈希相等（即还原） |
| C3 自我修正消息 | 在出错结果或待办翻转之后，模型来源的 `assistant/message` 包含词表条目 |
| C4 修复的计划偏离 | `todo/write` 条目由 `completed` 翻转为 `in_progress`/`pending` |
| C5 用户修正 | 长度 ≤ 200 字符且含词表条目的 `user/message`，出现在助手动作后 6 个事件内 |

规范 §2.3 排除项是结构性的：首次失败且无重试、死路错误不会命中 C1（没有重试调用）；压缩摘要使用独立日志事件类型，非模型来源的助手消息会被跳过；超过 200 字符的用户消息视为任务描述。C3/C5 词表是配置行，在任何会话运行前冻结于 bench-manifest.json——`loadConfigFromManifest(path)` 读取它，`matchLexicon(text, tokens)` 应用它（小写、整词匹配，`use ... instead` 短语按省略号拆分）。

## 后续添加

- `bench-run` — 每臂 N 次会话，每次会话独立会话目录，temperature 0，30 分钟硬超时，成本边车。
- `bench-report` — 配对逐任务表、逐类分解、含 95% 置信区间的成本块、单侧 Wilcoxon 符号秩 + McNemar、逐标准通过/失败。

## bench-audit

`bench-audit` 将确定性 C1..C5 分类器对导出的会话日志进行第二次应用，并报告与运行时间内记录的计数（第一遍，规范 §6.4）的一致性。运行方式为 `node --import tsx/esm packages/bench/bench/src/audit/cli.ts --clone-dir <dir> --additive-dir <dir> [--manifest bench-manifest.json] [--out classifier-audit.md]`；它会写出 classifier-audit.md + classifier-audit.json，包含逐会话的记录与重新分类对比表以及总体一致性（>= 0.95 时 PASS）。

## 配置（schemastery）

| key | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `lexicon` | `Record<string, string[]>` | `{}` | C1..C5 修正类词表，运行开始时冻结 |
| `model` | `string` | `''` | 两臂共用的固定模型 |
| `maxTokens` | `number` | `8192` | 每次会话生成上限 |
| `prices` | `Record<string, number>` | `{}` | 缓存/未缓存价格表，运行开始时冻结 |

以增量方式加入冻结的上游克隆：不修改任何现有包源码。

# Atlas Harness

[English](README.md) | 中文

**Atlas Harness** 是一个构建在 DeepSeek Harness 基础与 Cordis 插件主干之上的增量式 agent 能力框架（agent harness），由独立 AI 研究者 **Christopher Shaun Godwin** 撰写并维护。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## Atlas 增量

本仓库是 DeepSeek Harness 的分支，仅做增量修改。上游固定在提交 `47f943859b`（v0.1.0-rc.5，MIT）。跟踪与变更日志见 [UPSTREAM.md](UPSTREAM.md)；上游文件被冻结并通过 [FROZEN_FILES.sha256](FROZEN_FILES.sha256) 校验。任何上游文件均不被修改。

### 增量包（Additive packages）

- `packages/skill/skill-corpus` — `@atlasai/atsh-skill-corpus`：22 份 Atlas AI 撰写的 SKILL.md 技能语料（ctx.skills）
- `packages/memory` — `@atlasai/atsh-memory` + `@atlasai/atsh-tool-memory`：语义记忆存储（ctx.memoryStore），提供 memory_recall / memory_retain / memory_reflect 工具
- `packages/router` — `@atlasai/atsh-router` + `@atlasai/atsh-router-trainer`：带持久化调用日志的 LLM 路由（ctx.llmRouter、ctx.routerTrainer）
- `packages/cache` — `@atlasai/atsh-cache`：LLM 响应缓存（ctx.llmCache）
- `packages/kgraph` — `@atlasai/atsh-kgraph` + `@atlasai/atsh-tool-kgraph`：OKR 知识图谱（ctx.kgraph），提供 kgraph_upsert_objective / kgraph_record_evidence / kgraph_query 工具
- `packages/accounting` — `@atlasai/atsh-accounting`：带信用授予与预算上限的 token 台账（ctx.accounting）
- `packages/coordination` — `@atlasai/atsh-coordination`：基于子代理注册表的协作（ctx.coordination）
- `packages/research` — `@atlasai/atsh-research` + `@atlasai/atsh-tool-research`：xurl 与 arXiv 搜索工具（ctx.research）
- `packages/factory` — `@atlasai/atsh-factory` + `@atlasai/atsh-tool-factory`：计划契约与 BAR 评审（ctx.factory），提供 bar_critic / contract_status 工具

### 增量包 — 模型体验

增量包改变了模型、token 与提供方缓存的行为。其中影响最大的是默认上下文精简器 prompt-lume（`@atlasai/atsh-prompt-lume`，属于 `packages/prompt/` 组）。在每个 primed turn 上，它提炼当前工作意图，检索最相关的语料块并重新排序，然后将带来源标注、与任务对齐的区域注入到字节稳定的缓存核心**之后**。四个精简档位——`low`、`med`、`high`、`xhigh`——决定 hook 宽度。精确的每档位数据与实测的 trivial-turn token-in 递进见 [hook 宽度精简档位表](docs/prompt-lume.md#reduction-grades-hook-width-table)。模型体验摘要如下。

#### 模型看到什么

每个 primed turn 上，模型的系统提示词由字节稳定的核心（harness 身份、persona、能力语法——仅注入一次，整个会话保持一致）与一个任务对齐区域组成：区域由解析出的 hook 宽度选定，由带来源标注且最相关的语料块构成。没有 primed turn 或意图为空的 chunk 仅输出核心，不注入区域。选中的 chunk 数量与区域字节数取决于该档位的 hook 宽度行。

#### Token 效应

区域是唯一随 turn 变化的 token 内容；其字节预算（`budgetBytes`，每档位为 8192 / 4096 / 2048 / 512 之一）约束其大小。稳定核心贡献固定的 token 数。实测 trivial-turn 输入随档位单调下降（`low` → `med` → `high` → `xhigh` 分别为 761 → 394 → 210 → 87 tokens）；每个档位仍处于有限墙之后——不存在零提交档位。

#### KV 缓存效应

字节稳定的核心是提供方 prompt-cache 读取的稳定重复前缀：只要核心字节不变，缓存读取在整个会话中跨 turn 适用。档位切换、压缩与每 turn 渲染只触及区域路径，从不重写核心，因此缓存前缀在整个会话中存活。核心字节的任何漂移都会使该 turn 的缓存读取失效——该包在构造上保持核心字节一致。

## 研究

该增量层所测得的各维度记录于论文《What Actually Moves: Five Measured Axes of an Additive Agent Harness》（[Markdown](docs/paper/paper.md) · [LaTeX](docs/paper/paper.tex) · [PDF](docs/paper/paper.pdf)）。完整源码、图表与排版后的 PDF 归档在本仓库的 `docs/paper/` 目录下。

## 快速开始（Quickstart）

```sh
git clone https://github.com/patchshorts/atlas-harness.git
cd atlas-harness
pnpm install
pnpm run build
pnpm atsh web
```

使用 headless profile（增量模块组合在 host 平面）从源码运行单个任务：

```sh
pnpm atsh --profile headless "your task"
```

真实 LLM 调用需要在根目录 `.env` 中配置 `DEEPSEEK_API_KEY`。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
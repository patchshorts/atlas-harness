# skill-corpus — Atlas 22 项技能语料库

[English](README.md) | 中文

本包发布 Atlas 框架的技能语料库（22 个 SKILL.md 文件，由 Atlas AI 撰写），
作为 Atlas Harness 的捆绑技能根目录。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`skill-corpus/`](skill-corpus/) | 提供 22 个 SKILL.md 文件；注册到 `ctx.skills` | 注册到 `ctx.skills` |

## 模型体验

挂载本包后，技能目录新增 22 项技能：研究、GitHub 工作流、知识类
（wiki、Polymarket、JSON Canvas、Obsidian）与核心工程实践类技能。

技能通过 frontmatter 中的 kebab-case `name` 寻址（例如 `claude-code`、
`github-code-review`、`research-paper-writing`、`obsidian`）。正文通过标准 `ctx.skills` 加载器读取；
`tool-skill` 与 `skill-badge` 原样消费。

## 集成面

- **布局:** `corpus/<skill>/SKILL.md` — 单层结构，符合 Harness
  skill-filesystem 扫描器契约。
- **注册:** 插件将现有 `FileSystemSkillProvider`（来自
  `@atlasai/atsh-skill-filesystem`）通过 `customSkillDirs` 指向 `corpus/`，
  关闭默认根与文件监听。不修改任何现有包源码。
- **Provider 名称:** `atlas-corpus`（与默认 `filesystem` provider 区分）。

## 来源

- 由 Atlas AI（Christopher Shaun Godwin）从公共工程技能模式撰写。
  净化门禁 `tests/test_sanitization.py` 通过；无个人姓名、邮箱、电话、财务信息、
  密钥、API key、URL、IP、主机名、端口、项目 ID 或个人命名空间仓库路径。
- 数量: 磁盘上共 22 个规范 SKILL.md 文件（frontmatter 名称唯一）。

## 已知限制与延后工作

- 22 项语料库为 Atlas 当前的技能集合。当 Harness 需要新能力时，有意识地加以扩展。
- 语料库为静态内容。刷新策略: 按需有意识地扩展；每次刷新后重跑计数与扫描器测试。
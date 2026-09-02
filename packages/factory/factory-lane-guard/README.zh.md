# @atlasai/atsh-factory-lane-guard

修复 12/6 通道分离与注入防御（`ctx.laneGuard`）：基于通道的指令标记
（系统 > 工具输出）、harness 边界的工具调用白名单、PromptArmor 模式
的净化（sanitization）通道、针对 in-band 类别的污染感知（taint）验证。
本包绝不改写会话日志或消息历史——每一次通道都返回新的派生值（金规
golden rule）。

## 模型体验（Model Experience）

- **确定性核心零模型调用。** `defend()`、白名单闸门、`markChannels()`、
  `sanitize()`、`verifyComposed()` 均为纯确定性函数——无 LLM、无网络、
  无 token 开销。污染验证器的三元组提取启发式只是生产环境中模型通道的
  替身；验证器只基于已提取的三元组运行。
- **Token 影响。** 本包自身无影响。调用方若在进入上下文之前接入净化
  通道，则会减少模型看到的 token（被剥离的文本永远不会进入上下文）；
  本包不重写会话日志或投影。
- **KV 缓存影响。** 无。本包不持有任何模型可见状态，绝不写入消息历史。

## 安装与挂载

```ts
import LaneGuardService from '@atlasai/atsh-factory-lane-guard'

ctx.plugin(LaneGuardService, {
  allow: ['search', 'web_search', 'read_file'], // 非空 => 默认拒绝其余一切
  deny: [],                                     // deny 优先于 allow
  sanitize: true,                               // 默认：启用剥离通道
  taint: true,                                  // 默认：启用污染验证
})
```

服务只注册一个运行时效果：针对 tools guard 层注册工具调用白名单守卫，
通过 `ctx.get('tools')` 可选读取（绝不使用 `ctx.tools`——拓扑敏感的代理）。
未挂载 tools 服务时本服务为被动模式。其余均为纯派生通道与公开服务方法。

## 配置

| key | 类型 | 默认值 | 说明 |
| --- | ---- | ------ | ---- |
| `enabled` | `boolean` | `true` | 为 false 时服务被动：不注册守卫，闸门方法抛出 `lane-guard disabled`，sanitize 原样返回输入 |
| `allow` | `string[]` | `[]` | glob 模式（精确匹配或 `*` 后缀前缀匹配）；非空 => 默认拒绝其余一切 |
| `deny` | `string[]` | `[]` | deny 优先于 allow |
| `sanitize` | `boolean` | `true` | false 时禁用净化通道（被动恒等） |
| `taint` | `boolean` | `true` | false 时禁用污染验证（被动结论） |

## 事件

| 事件 | 载荷 | 说明 |
| ---- | ---- | ---- |
| `lane/veto` | `LaneVetoRecord` | 一个工具调用被白名单闸门拒绝（`name`、`reason`、`ts`） |

## 22 载荷夹具（fixture）

`tests/fixtures/injection-payloads.ts` 复现 Pass 6 的经验结果（kgraph，
2026-08-17）：**工具闸门处 22 中抵抗 19（19/22）**——类别 1 显式指令攻击
（9 个）、类别 2 工具调用指令（5 个）、类别 3 in-band 变体与标记伪造
（8 个）。`defend()` 通过净化通道（标记/伪造/编码块剥离）或白名单闸门
实现抵抗；恰好 3 个不抵抗的载荷（`in-band-summary`、`in-band-fact`、
`in-band-lie`）即文档记载的 in-band 上限——纯内容、无定向工具、harness
边界无法看到的载荷。

## 已知限制与后续工作（Known Limitations and Deferred Work）

- **in-band 上限无法被闸门捕获。** 无定向工具的纯内容 in-band 载荷
  （`in-band-summary`、`in-band-fact`、`in-band-lie`）不会被 `defend()`
  抵抗。污染验证与输出校验是模型层防御；本包暴露它们
  （`verifyComposed`、`toTriples`）但并未接入。
- **净化是 PromptArmor 的确定性近似，而非模型支撑的分类器。** 标记列表
  偏保守；新措辞可绕过，合法文本也可能在标记短语上误报。
- **闸门是 harness 边界防御。** 由调用方在进入上下文之前接入净化通道；
  本包证明该通道，并不将其安装进提示词流水线。
- **污染提取器是启发式的。** 真实提取是模型通道；启发式使确定性测试套件
  自包含。

## 金规（Golden rule）

绝不写入会话日志或消息历史——只追加持有。通道标记、净化与污染验证均为
基于副本的派生通道，返回新数组/新字符串；输入保持逐字节不变（由本包
测试断言）。

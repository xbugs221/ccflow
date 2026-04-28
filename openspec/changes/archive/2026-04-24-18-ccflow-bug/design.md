## Context

当前工作流创建流程会先生成新的 workflow draft child session，再导航到新的 `wN/cN` 路由。现有验收只验证“创建后 URL 进入 `wN/cN`”，没有验证“聊天面板是否真的切到了新 child session 的消息上下文”。用户实际复现表明，在 `w1/c1` 里已有聊天状态时创建 `w2`，虽然 URL 会进入 `w2/c1`，但消息面板仍显示 `w1/c1` 的内容。

这说明问题不在单一后端接口，而在前端三个状态源之间的交接：

- 路由解析后的 `selectedSession`
- 聊天组件内部维护的 `currentSessionId`
- 聊天组件内部缓存的 `chatMessages/sessionMessages`

只要其中任意一个在创建新工作流后没有与新 draft child session 同步，就会出现“URL 已切到新工作流、视图仍停留在旧会话”的串台。

## Goals / Non-Goals

**Goals:**

- 保证从已有工作流子会话内创建新工作流后，新的 `wN/c1` 始终展示自己的会话视图。
- 保证工作流 child session 的消息加载以当前规范路由对应的持久化会话为准，不能复用前一个 workflow 的聊天状态。
- 为该真实业务链路补充稳定的验收测试，并覆盖刷新后的隔离行为。

**Non-Goals:**

- 不调整工作流编号分配规则。
- 不改动普通手动会话的路由格式。
- 不改变工作流自动启动 prompt 的业务内容。

## Decisions

### 1. 以路由解析出的 workflow child session 作为唯一真源

进入 `/<project>/wN/cN` 后，页面必须把该路由解析出的 child session 视为唯一真源，并用它重建聊天视图。不能因为当前组件里仍保留旧的 `currentSessionId` 或旧的 `chatMessages` 而继续展示前一个工作流的消息。

备选方案：

- 仅在创建新工作流后强制刷新整个页面。
  放弃原因：能绕过问题，但不能保证后续切换、刷新和回访都满足同样约束。
- 仅在创建 workflow 成功后清空聊天消息。
  放弃原因：如果 `currentSessionId` 没同步，新消息流仍可能继续落到旧会话。

### 2. 会话切换必须同时重置 session id 与消息缓存

当 `selectedSession.id` 从旧 workflow child session 切到新 workflow child session 时，聊天层必须把这次变化识别为真实的 session 切换，并同步重置旧消息缓存、旧流式状态和旧 pending 视图引用，再基于新 session 重新拉取消息。

备选方案：

- 只比较 `session.id` 是否变化。
  风险：如果 draft handoff 或路由恢复阶段存在短暂的对象复用，仍可能留下错误上下文。
- 对 ChatInterface 整体加 React `key` 强制 remount。
  可行但较重，会扩大受影响范围；优先先修状态同步逻辑，必要时再加组件级隔离。

### 3. 验收测试直接覆盖用户复现链路

新增一条 Playwright 验收测试，步骤为：先进入 `w1/c1` 并确认其消息存在，再创建 `w2`，断言页面进入 `w2/c1`，且聊天视图不再显示 `w1/c1` 的历史消息；随后刷新页面，断言仍保持隔离。

备选方案：

- 只补单元测试。
  放弃原因：这个问题发生在路由、选择态和聊天状态的交界处，单元测试很难完整覆盖用户看到的串台现象。

## Risks / Trade-offs

- [聊天层为了修复串台而更积极地清空本地消息缓存] → 需要确保只在真实 session 切换时触发，避免同一会话正常流式更新时被误清空。
- [workflow draft session 和 provider 真实 session 的交接存在短暂空窗] → 需要保留现有 draft handoff 逻辑，但不能让空窗回退到旧 workflow 会话。
- [验收测试依赖 fixture 中现有的 `w1/c1` 消息内容] → 使用仓库现有 fixture 文案，保持断言稳定并与真实业务链路一致。

## Migration Plan

1. 先补 OpenSpec delta 和验收测试，固定目标行为。
2. 调整前端 workflow child session 切换逻辑，确保创建新 workflow 后聊天状态与路由一致。
3. 运行 `tests/spec/project-workflow-child-session-isolation.spec.js` 验证修复。
4. 若修复引入回归，再回滚到旧实现并保留本次验收测试，继续定位状态同步缺口。

## Open Questions

- 若新 workflow 的 draft child session 尚未生成任何消息，聊天区应该显示空白初始态还是明确的“准备中”提示？本次先只要求“不显示旧 workflow 消息”，不新增新的占位交互。

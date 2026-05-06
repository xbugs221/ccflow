## Why

当前需求工作流子会话的规范路由已经改成 `/<project>/wN/cN`，但从已有工作流子会话内部新建下一个工作流时，界面仍可能继续展示上一个工作流的聊天内容。这个问题会让用户误以为新工作流没有创建自己的会话入口，直接破坏多需求并行的基本可用性。

## What Changes

- 修正从已有工作流子会话内创建新工作流时的会话切换行为，确保新工作流首个子会话始终绑定并展示自己的消息上下文。
- 收紧工作流子会话路由恢复约束，要求进入新的 `wN/cN` 页面时必须以该路由对应的持久化会话为唯一消息来源，不能复用前一个工作流的聊天状态。
- 补充验收测试，覆盖“先进入 `w1/c1` 聊天，再创建 `w2` 并进入 `w2/c1`”的真实业务链路，以及刷新后的隔离行为。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `project-workflow-control-plane`: 工作流详情进入子会话后，创建后续工作流时必须切换到新工作流自己的首个子会话视图，不能继续展示前一个工作流的消息。
- `project-route-addressing`: 工作流子会话规范路由的恢复行为需要补充“跨工作流创建后切换”和“刷新后隔离”的要求，保证 `wN/cN` 只加载自己的持久化会话上下文。

## Impact

- 前端路由与选择态：`src/hooks/useProjectsState.ts`
- 工作流创建与自动启动：`src/utils/workflowAutoStart.ts`
- 聊天会话状态恢复：`src/components/chat/view/ChatInterface.tsx`
- 聊天消息加载与切换：`src/components/chat/hooks/useChatSessionState.ts`
- 验收测试：`tests/spec/*.spec.js`

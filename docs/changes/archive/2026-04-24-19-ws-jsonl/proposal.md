## Why

Codex 聊天在实时 WebSocket 推送和刷新后 JSONL 回放之间存在内容与样式差异，用户会看到同一轮对话在刷新前后变成不同形态。需要以 JSONL 的实际持久化内容为准，统一实时呈现和历史恢复的视觉契约，避免工具调用、文件编辑和 ctx 系列指令在刷新后才出现或样式变化。

## What Changes

- 以 Codex JSONL 记录作为聊天消息呈现的最终真相，定义实时 WS 事件必须归一到同一套 UI 消息模型。
- 为 Codex 工具调用建立统一卡片组呈现：顶部固定显示发起指令，运行中展示最新五行输出，完成或失败后默认全部折叠。
- 覆盖普通 assistant/user 消息、thinking/commentary、tool_use/tool_result、Edit file、ctx 系列工具和错误状态的刷新前后一致性。
- 增加验收测试，验证实时过程和刷新后的历史回放在关键业务场景中视觉一致。

## Capabilities

### New Capabilities
- `codex-jsonl-message-rendering`: 规定 Codex JSONL 与 WebSocket 动态推送在聊天 UI 中的消息归一化、工具卡片生命周期和刷新后一致性。

### Modified Capabilities
- 无。

## Impact

- 影响 Codex 流式事件处理、聊天历史加载、消息转换和工具渲染组件。
- 主要涉及 `server/openai-codex.js`、`src/contexts/WebSocketContext.tsx`、`src/components/chat/hooks/useChatRealtimeHandlers.ts`、`src/components/chat/hooks/useChatSessionState.ts`、`src/components/chat/utils/messageTransforms.ts`、`src/components/chat/tools/ToolRenderer.tsx` 及相关工具内容渲染组件。
- 不引入新的外部依赖；测试使用仓库现有 Playwright/spec 测试体系。

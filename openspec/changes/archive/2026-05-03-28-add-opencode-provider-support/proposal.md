## Why

ccflow 当前仅支持 Claude Code 和 OpenAI Codex CLI 两种 AI provider。引入 OpenCode 的完整后端集成（SDK、REST 路由、会话发现、WebSocket、工作流）涉及大量新代码和测试，需要分多个变更逐步落地。

本变更只承担 **UI 与类型层面的脚手架**，让 `opencode` 在前端读模型中存在并可被选中渲染，不引入任何 OpenCode 后端依赖。后端 SDK、会话发现、消息归一化、WebSocket、工作流执行等能力将在后续变更中独立提出和验收，避免一次性引入大量未完成实现。

## What Changes

- 在前端类型 `SessionProvider`、`AgentProvider` 中加入 `'opencode'`，使所有 provider 列表读模型可承载 OpenCode。
- 在设置常量 `AGENT_PROVIDERS`、`AUTH_STATUS_ENDPOINTS` 中登记 OpenCode，使设置页 agent 选项卡能渲染该 provider。
- 在 `Project` 读模型中增加可选 `opencodeSessions` 字段，让后续后端变更可以无破坏地填充会话索引。
- 在 agent 设置 UI（`AgentListItem`、`AgentsSettingsTab`、`AccountContent`、`PermissionsContent`）中接入 OpenCode 颜色、标签和占位 props，使 UI 能容纳第三方 provider 而不破坏现有 Claude/Codex 路径。
- 在聊天 `ProviderSelectionEmptyState` 中增加 OpenCode 文案占位。
- 显式声明：本变更不新增任何后端文件、不调用 OpenCode CLI/SDK、不接入 WebSocket、不执行工作流。

## Capabilities

### New Capabilities

- `opencode-provider-scaffolding`: 覆盖前端类型、常量、设置 UI 中 OpenCode 作为可识别 provider 的最小存在性，以及确保新增字段不破坏 Claude/Codex 现有读模型。

### Modified Capabilities

无。后续 OpenCode 后端、会话发现、工作流集成应在独立变更中作为 Modified Capabilities 引入。

## Impact

- `src/types/app.ts`：扩展 `SessionProvider` 与 `Project.opencodeSessions`。
- `src/components/settings/types/types.ts`、`src/components/settings/constants/constants.ts`：扩展 `AgentProvider`、`AGENT_PROVIDERS`、`AUTH_STATUS_ENDPOINTS`。
- `src/components/settings/view/tabs/agents-settings/AgentListItem.tsx`、`AgentsSettingsTab.tsx`、`sections/content/AccountContent.tsx`、`sections/content/PermissionsContent.tsx`：增加 OpenCode 视觉配置和 prop 占位。
- `src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx`：增加 OpenCode 文案占位。
- `tests/spec/`：增加针对脚手架（类型 / UI / 占位）的最小验收测试。

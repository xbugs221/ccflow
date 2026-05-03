## Context

ccflow 的 provider 抽象目前以扁平方式实现：后端在 `server/` 下放 `claude-sdk.js`、`openai-codex.js`，前端通过 `SessionProvider = 'claude' | 'codex'` 等类型硬编码。要把 OpenCode 引入为一等 provider 涉及大量后端和前端工作（SDK 模块、REST 路由、会话发现、WebSocket、工作流集成），需要分多个变更落地。

本变更（28）只承担 **UI 与类型层面的脚手架**，将 OpenCode 注册为可识别的 provider 类型，并在设置 agent 选项卡中加入视觉占位。这是后续 OpenCode 后端变更可以无破坏接入的最小前置层。

## Goals / Non-Goals

**Goals:**

- 在前端类型 `SessionProvider`、`AgentProvider` 中加入 `'opencode'`。
- 在设置常量 `AGENT_PROVIDERS`、`AUTH_STATUS_ENDPOINTS` 登记 OpenCode。
- 在 `Project` 读模型中加入可选 `opencodeSessions` 字段。
- 在 agent 选项卡 UI 中给 OpenCode 提供视觉配置（颜色、卡片、prop 占位），使 OpenCode tab 在视觉层可被渲染而不抛错。
- 在聊天空状态 ready prompt map 中加入 opencode 文案键。
- 通过最小静态测试固定上述脚手架，使后续后端变更不会因为前端类型缺失而无法接入。

**Non-Goals:**

- 不实现任何 OpenCode 后端（无 `server/opencode-sdk.js`、`server/routes/opencode.js`）。
- 不实现 OpenCode 会话发现、消息归一化、JSONL 解析。
- 不接入 WebSocket、`abortOpencodeSession`、`queryOpencode` 等运行时 API。
- 不修改 `server/projects.js`、`server/workflows.js`、`server/workflow-auto-runner.js`。
- 不实现 `/api/opencode/models`、`/api/cli/opencode/status` 等 HTTP 端点。
- 不为聊天界面接入真实的 OpenCode 模型选择或流式响应。

## Decisions

### 1. 仅做 UI/类型脚手架，后端拆为独立变更

OpenCode 的后端集成（SDK、REST 路由、会话扫描、WebSocket 分支、工作流执行）会引入大量代码与依赖，远超一个变更的合适范围。本变更先把前端类型和 UI 占位落地，使后续后端变更可以以现有类型为输入，并保持每个变更的可独立审核与回滚性。

替代方案：在同一变更中完整实现后端。拒绝原因：变更范围过大、风险集中、回滚困难，且前端类型脚手架本身可以被验收，不需要等待后端实现。

### 2. AUTH_STATUS_ENDPOINTS 中先登记字符串占位

`AUTH_STATUS_ENDPOINTS.opencode` 在本变更中只是一个常量字符串。前端不会在本变更中实际向该端点发起请求，对应后端实现属于后续变更。这样登记可以让设置 UI 通过类型检查，并在后端就绪后无需改前端。

### 3. PermissionsContent 类型放宽为 AgentProvider

`PermissionsContent` 原硬编码 `agent: 'claude' | 'codex'`。本变更将其放宽为 `AgentProvider`，使其与新增的 `opencode` 兼容，避免在设置 UI 出现编译错误。运行时行为不变。

## Risks / Trade-offs

- [脚手架与后端脱节] -> 类型/常量已存在但缺乏后端实现。中和：通过本变更测试只校验脚手架不能误导用户；并在 tasks.md 第 5 节明确标记后端为后续变更。
- [字符串端点占位] -> 端点字符串在前端常量中存在，但后端没有该路由。中和：前端在没有真实调用前不会触发；本变更不增加任何运行时调用该端点的代码路径。

## Migration Plan

1. 落地前端类型与常量。
2. 落地 agent 选项卡 UI 占位（不影响 Claude/Codex 现有路径）。
3. 落地最小静态测试固定脚手架。
4. 后续独立变更补齐后端 SDK、路由、会话发现、WebSocket、工作流，并以本变更类型/常量为输入。

## Open Questions

- 后续变更应优先实现 `/api/cli/opencode/status` 还是 `/api/opencode/sessions`，以最小化前端等待时间。

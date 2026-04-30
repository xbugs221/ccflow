## Why

当前 ccflow 工作流所有阶段（planning、execution、review、repair、archive）均硬编码使用 codex provider。用户无法根据阶段特性灵活选择 codex 或 claude，限制了工作流的适用场景（如规划阶段适合 claude 的深度推理，执行阶段适合 codex 的代码生成）。

## What Changes

- 工作流数据模型增加 `stageProviders` 字段，记录每个阶段使用的 provider（codex/claude），默认全部为 codex
- 创建工作流时，表单底部增加可折叠的"阶段配置"面板，让用户为每个阶段预设 provider
- 工作流详情页（WorkflowDetailView）的每个阶段行右侧增加 provider 徽标/下拉，允许运行时调整（未启动阶段可切换，已启动阶段只读）
- 后端 `buildWorkflowLauncherConfig()` 返回的 launcher payload 包含阶段对应的 provider
- 后端 `launchWorkflowAction()` 根据 provider 动态调用 `queryCodex` 或 `queryClaudeSDK`
- 前端 `MainContent.tsx` 的 `onNewSession()` 调用使用 launcher payload 中的 provider，不再硬编码 'codex'
- 新增 API `PUT /api/projects/:projectName/workflows/:workflowId/stage-providers`
- 向后兼容：旧工作流无 `stageProviders` 时默认全部使用 codex

## Capabilities

### New Capabilities
- `workflow-stage-provider-selection`: 工作流各阶段独立配置 AI provider（codex/claude），支持创建时预设和运行时调整

### Modified Capabilities
- `project-workflow-control-plane`: 工作流控制面的阶段列表展示和会话启动逻辑需要支持按阶段指定的 provider 启动会话

## Impact

- 后端：`server/workflows.js`（数据模型、持久化、launcher config）、`server/workflow-auto-runner.js`（自动执行分支）、`server/index.js`（新增路由）
- 前端：`src/types/app.ts`、`src/utils/api.js`、`src/utils/workflowAutoStart.ts`、`ProjectWorkspaceNav.tsx`、`SidebarProjectWorkflows.tsx`、`WorkflowDetailView.tsx`、`MainContent.tsx`
- 无外部依赖变更，无数据库 schema 变更（配置存储在项目 `conf.json` 中）

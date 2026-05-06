## Context

当前 ccflow 工作流的后端 `launchWorkflowAction()` 和前端 `MainContent.tsx` 均硬编码使用 `codex` provider。工作流数据模型 `stageStatuses` 只记录 `{key, label, status}`，没有 provider 维度。用户无法为不同阶段的特性选择更合适的 AI provider（如规划阶段使用 claude、执行阶段使用 codex）。

## Goals / Non-Goals

**Goals:**
- 每个工作流阶段可独立配置 provider（codex / claude）
- 创建工作流时可统一预设各阶段 provider
- 工作流详情页可查看和修改未启动阶段的 provider
- 自动执行和手动"继续推进"均按阶段配置的 provider 启动会话
- 旧工作流向后兼容，默认全部使用 codex

**Non-Goals:**
- 运行时热切换已启动会话的 provider（已启动阶段 provider 锁定）
- 支持 codex/claude 以外的 provider
- 在子会话内部切换 provider（阶段级别配置已足够）
- 按阶段配置 model/reasoningEffort 等细粒度参数（本变更只处理 provider）

## Decisions

### 1. 数据模型：`stageProviders` 独立字段 vs `stageStatuses[].provider`

**选择**：两个字段都保留，但主存储用 `workflow.stageProviders: Record<string, 'codex' | 'claude'>`。

**理由**：
- `stageProviders` 与 `stageStatuses` 正交，一个管"用什么 AI"，一个管"阶段进度"。分开存储避免每次改 provider 都触发 stage status 的重比较
- `WorkflowStageStatus.provider` 作为运行时派生字段，由 `normalizeWorkflow()` 从 `stageProviders` 填充，方便前端直接读取
- `compactWorkflowForStore()` 只需判断 `stageProviders` 是否非空即可决定是否持久化

**替代方案**：只在 `stageStatuses` 中加 provider，被否决——会污染 `isDefaultStageStatuses()` 的判断逻辑，导致旧数据也持久化 provider 默认值。

### 2. 运行时 provider 切换规则

**选择**：未启动阶段（无活跃子会话）可自由切换 provider；已启动阶段 provider 锁定。

**理由**：
- 避免跨 provider 的会话上下文混乱（codex JSONL 与 claude 会话格式不兼容）
- 前端实现简单：检查 `stageSession` 是否存在即可决定是否禁用下拉

### 3. 自动执行启动入口：launcher config 中携带 provider

**选择**：`buildWorkflowLauncherConfig()` 返回的 payload 中增加 `provider` 字段；`launchWorkflowAction()` 根据此字段分支到 `queryCodex` 或 `queryClaudeSDK`。

**理由**：
- 自动执行链不需要改动 `resolveWorkflowAutoAction()` 的逻辑，只在执行层分发
- `queryClaudeSDK` 与 `queryCodex` 的函数签名兼容（`command, options, ws`），可复用同一个 writer

### 4. 前端手动继续推进：从 launcher payload 读取 provider

**选择**：`MainContent.tsx` 的 `onContinueWorkflow` 中，`onNewSession(project, launcherOptions.provider || 'codex', launcherOptions)`。

**理由**：
- 与自动执行保持一致，统一从后端 launcher config 决定 provider
- 避免前端两份 provider 决策逻辑（创建时的默认值 vs 详情页修改后的值）

## Risks / Trade-offs

- [Risk] `queryClaudeSDK` 与 `queryCodex` 的 WebSocket 事件格式不同，writer 回调需兼容 → **Mitigation**: writer 回调只关心 sessionId 注册和定时器调度，不处理具体消息格式，两者共用同一个 writer 接口
- [Risk] `renameCodexSession` 在 claude 路径下不存在对等操作 → **Mitigation**: `launchWorkflowAction()` 中 rename 只在 codex 分支执行，claude 分支跳过（claude 会话标题由 `createWorkflowAutoStartDraft` 在注册时已设置）
- [Risk] 前端类型定义变更可能影响现有 `WorkflowStageStatus` 的使用 → **Mitigation**: `provider` 字段设为可选，所有现有消费代码无需改动

## Migration Plan

无需迁移步骤：
- `expandWorkflowFromStore()` 遇到旧 workflow 时 `stageProviders` 为 undefined → 默认 codex
- `buildWorkflowLauncherConfig()` 返回 `provider: workflow.stageProviders?.[stage] || 'codex'`
- 旧 workflow 在详情页展示时，`stageProviders` 为空 → 所有阶段显示 codex 徽标

## Open Questions

- `queryClaudeSDK` 的 `sessionId` 传参行为是否与 codex 一致（是否支持 resume）？当前代码中 launcher config 通过 `attachExistingWorkflowStageSession()` 已有 `sessionId` 复用逻辑，claude 路径可直接复用该 sessionId

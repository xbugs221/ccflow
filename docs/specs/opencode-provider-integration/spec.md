# opencode-provider-integration 规格

## 目的
待补充 - 由归档变更 28-add-opencode-provider-support 创建。归档后请更新目的说明。
## 需求
### Requirement: OpenCode 必须作为可识别的 provider 类型存在

系统 MUST 在前端 provider 类型与设置 agent 注册表中将 `opencode` 与 `claude`、`codex` 并列登记，使后续后端集成可以无破坏地接入读模型。

本变更只承担类型与 UI 注册层面的脚手架，不要求任何后端 SDK、REST 路由、会话发现、WebSocket、工作流执行能力。这些能力将在独立变更中提出。

#### Scenario: SessionProvider 类型包含 opencode

- **WHEN** 任何模块通过 `import type { SessionProvider } from 'src/types/app'` 引用会话 provider 类型
- **THEN** 该类型 MUST 同时允许 `'claude'`、`'codex'`、`'opencode'` 三个字面量
- **AND** `Project` 读模型 MUST 包含可选的 `opencodeSessions` 字段，类型与 `sessions`、`codexSessions` 一致
- **AND** 该字段 MUST 默认未填充，不要求后端在本变更中产出实际数据

#### Scenario: AgentProvider 类型与常量包含 opencode

- **WHEN** 任何模块引用设置层 `AgentProvider` 类型或 `AGENT_PROVIDERS` 常量
- **THEN** 类型 MUST 允许 `'opencode'`
- **AND** `AGENT_PROVIDERS` 数组 MUST 同时包含 `'claude'`、`'codex'`、`'opencode'`
- **AND** `AUTH_STATUS_ENDPOINTS` MUST 为 `opencode` 登记一个字符串端点占位（实际后端实现不属于本变更）

### Requirement: 设置 agent 选项卡 UI 必须能渲染 OpenCode 占位

系统 MUST 在设置 agent 选项卡的 UI 配置表中，为 `opencode` 提供与 `claude`、`codex` 同形的视觉配置，使 OpenCode tab 在视觉层可被渲染而不抛错。

#### Scenario: AgentListItem 含 OpenCode 配置

- **WHEN** 设置页渲染 agent 列表
- **THEN** `AgentListItem` 的内部 `agentConfig` 表 MUST 包含 `opencode` 项，并提供合法 `name` 与 `color`
- **AND** `colorClasses` MUST 含与该 color 匹配的样式键，避免 `undefined` 样式

#### Scenario: AccountContent 含 OpenCode 视觉配置

- **WHEN** 用户切换到 OpenCode agent tab 的 Account 区块
- **THEN** `AccountContent` 的 `agentConfig` MUST 包含 `opencode` 项，提供 name、bg、border、text、subtext、button 类
- **AND** 缺失认证状态时 UI MUST 不抛错（占位渲染允许显示 “未登录” 等默认文案）

#### Scenario: PermissionsContent 接受任意 AgentProvider

- **WHEN** Permissions 区块以 `agent: AgentProvider` 渲染
- **THEN** 类型 MUST 允许 `'opencode'`，不再硬编码 `'claude' | 'codex'`
- **AND** 对未知 provider 的 allowed/disallowed tools 操作 MUST 与现有 Claude/Codex 行为保持一致

### Requirement: 聊天 ProviderSelectionEmptyState 必须为 OpenCode 提供文案键

系统 MUST 在聊天空状态的 ready prompt map 中为 `opencode` 提供文案键，避免后续启用 OpenCode 时出现 `undefined` 文案。

#### Scenario: ready prompt map 含 opencode 键

- **WHEN** `ProviderSelectionEmptyState` 渲染 ready prompt
- **AND** 当前 provider 为 `'opencode'`
- **THEN** prompt map MUST 通过 `t('providerSelection.readyPrompt.opencode', ...)` 解析出非 undefined 字符串
- **AND** 缺失 opencode 模型上下文时 MUST 不抛错


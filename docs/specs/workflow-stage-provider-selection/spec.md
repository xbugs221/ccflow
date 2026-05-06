## Purpose

定义 Go-backed 工作流自动阶段的 provider 约束。自动 workflow 的事实状态机是外部 Go runner `mc`，首期只支持 Codex；Claude/OpenCode 仍可用于普通手动会话，但不得作为自动阶段 fallback。

## Requirements

### Requirement: Go-backed 自动工作流必须固定 Codex provider

系统 MUST 将新建 Go-backed workflow 的自动阶段 provider 固定为 `codex`。旧的 `stageProviders` / `providers` 配置不得影响 Go runner 自动阶段。

#### Scenario: 创建 Go-backed workflow 时提交非 Codex provider

- **WHEN** 创建 workflow 的请求包含 `stageProviders` 且某阶段为 `"claude"`
- **THEN** 后端创建的 workflow 仍记录 `runnerProvider: "codex"`
- **AND** 每个自动阶段的 provider 派生值为 `"codex"`
- **AND** 配置文件不持久化旧 `stageProviders` 覆盖

#### Scenario: 更新 Go-backed workflow 的阶段 provider

- **WHEN** 客户端尝试把 Go-backed workflow 的任一自动阶段 provider 改为 `"claude"`
- **THEN** 后端拒绝该请求
- **AND** 系统不会启动旧 Node auto-runner 或 Claude 自动阶段作为 fallback

### Requirement: 手动会话 provider 不受 Go runner 限制

系统 MUST 继续允许用户在项目中创建 Claude/Codex/OpenCode 手动会话。该限制只作用于 Go-backed workflow 的自动推进阶段。

#### Scenario: 创建普通手动会话

- **WHEN** 用户在项目中创建普通 Claude 会话
- **THEN** 系统按普通会话 provider 逻辑创建会话
- **AND** 不受 workflow `runnerProvider: "codex"` 约束

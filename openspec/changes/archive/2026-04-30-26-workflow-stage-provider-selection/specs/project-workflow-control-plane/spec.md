## Purpose

定义 project-workflow-control-plane 能力因 workflow-stage-provider-selection 引入的交互增强。本 spec 为 delta spec，仅记录新增和修改的 requirements，完整规范见 openspec/specs/project-workflow-control-plane/spec.md。

## ADDED Requirements

### Requirement: 创建工作流表单必须提供阶段 provider 配置入口

系统 MUST 在工作流创建表单中提供可选的"阶段配置"折叠面板，让用户为每个阶段选择 provider。面板 MUST 默认折叠，且所有阶段默认选中 codex。用户展开面板并修改后，所选配置 MUST 随创建请求提交到后端。

#### Scenario: 创建时展开阶段配置面板并修改 provider
- **WHEN** 用户在创建工作流时点击"阶段配置"折叠面板
- **AND** 将 planning 阶段从 codex 切换为 claude
- **AND** 其余阶段保持 codex
- **THEN** 创建请求体中包含 `stageProviders: { planning: "claude" }`
- **AND** 后端据此创建带阶段 provider 配置的工作流

#### Scenario: 创建时不展开阶段配置面板
- **WHEN** 用户直接填写摘要和需求正文并创建工作流
- **AND** 未展开"阶段配置"面板
- **THEN** 创建请求体中不提交 stageProviders 字段
- **AND** 后端创建的工作流所有阶段隐式默认使用 codex

### Requirement: 工作流详情页阶段列表必须展示 provider 信息

系统 MUST 在工作流详情页的阶段列表中，每个阶段标题旁展示该阶段当前配置的 provider（codex 或 claude）。对于尚未启动的阶段，系统 MUST 提供 provider 下拉切换控件；对于已有活跃子会话的阶段，provider MUST 只读显示。

#### Scenario: 未启动阶段显示可切换的 provider 下拉
- **WHEN** 用户查看某工作流详情页
- **AND** execution 阶段状态为 pending 且无活跃子会话
- **THEN** execution 阶段标题旁显示 provider 下拉控件
- **AND** 下拉当前值为该阶段配置的 provider
- **AND** 用户切换后系统调用后端 API 持久化新配置

#### Scenario: 已启动阶段只读显示 provider 徽标
- **WHEN** 用户查看某工作流详情页
- **AND** planning 阶段已有活跃子会话
- **THEN** planning 阶段标题旁显示当前 provider 徽标（非下拉控件）
- **AND** 徽标 hover 时提示"阶段已启动，provider 锁定"

## MODIFIED Requirements

（本 capability 的现有 requirements 语义未发生行为级变更，仅在前端展示层面增加 provider 维度。）

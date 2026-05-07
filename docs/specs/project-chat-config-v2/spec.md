# project-chat-config-v2 Specification

## Purpose

Define the v2 project-local `.ccflow/conf.json` structure for human-readable manual chat session state.

## Requirements

### Requirement: 项目配置必须用 chat 分组保存手动会话状态

系统 MUST 将项目本地 `.ccflow/conf.json` 的手动会话状态保存为 `schemaVersion: 2`，并使用顶层 `chat` 分组表达人类可读的手动会话索引。自动工作流不得写入 `.ccflow/conf.json.workflows`；工作流列表和详情必须从 `.ccflow/runs/<run-id>/state.json` 派生。

#### Scenario: 保存项目配置时写入 v2 分组结构

- **WHEN** 系统保存包含普通会话的项目配置
- **THEN** 配置文件包含 `schemaVersion: 2`
- **AND** 普通会话只写入顶层 `chat`
- **AND** 配置文件不包含自动工作流镜像索引 `workflows`
- **AND** 新配置不再写入 `manualSessionDrafts`、`sessionRouteIndex`、`sessionSummaryById`、`sessionWorkflowMetadataById`、`sessionModelStateById` 或 `sessionUiStateByPath`

#### Scenario: 单条普通会话聚合所有展示状态

- **WHEN** 一个普通会话存在编号、真实或草稿 sessionId、标题、模型、思考深度和 UI 状态
- **THEN** 顶层 `chat["<编号>"]` 包含 `sessionId`、`title`、`model`、`reasoningEffort` 和 `ui`
- **AND** `sessionId` 作为 value 字段保存，不作为对象 key
- **AND** 编号 key 只表达项目内展示顺序

### Requirement: 顶层 chat 编号必须统一覆盖 WebUI 与终端会话

系统 MUST 将 WebUI 手动会话和终端发起的 standalone Codex 会话放入同一个顶层 `chat` 编号空间，并且编号不回收。

#### Scenario: 终端会话已占用编号后新建 WebUI 草稿

- **WHEN** 项目配置中已有 `chat["18"]` 和 `chat["19"]` 指向终端发起的 Codex 会话
- **AND** 用户在 WebUI 点击新建普通会话
- **THEN** 系统创建 `chat["20"]`
- **AND** 新草稿不会复用 `18` 或 `19`

#### Scenario: 删除普通会话后编号不回收

- **WHEN** 项目中曾经创建过 `chat["1"]` 和 `chat["2"]`
- **AND** `chat["1"]` 被删除
- **AND** 用户再次新建普通会话
- **THEN** 系统创建 `chat["3"]`
- **AND** 系统不会重新创建 `chat["1"]`

### Requirement: 草稿会话必须原地 finalize

系统 MUST 在请求真实 provider 前为草稿会话分配稳定编号和草稿 `sessionId`，并在真实 sessionId 返回后原地替换，不得移动记录或改变编号。

#### Scenario: WebUI 普通草稿 finalize

- **WHEN** 用户在 WebUI 创建普通草稿会话
- **THEN** 系统立即写入 `chat["<编号>"].sessionId` 为草稿 id
- **WHEN** provider 返回真实 session id
- **THEN** 系统只替换同一条 `chat["<编号>"].sessionId`
- **AND** 该条记录的 `title`、`model`、`reasoningEffort` 和 `ui` 保持不变

#### Scenario: 草稿未发送真实请求

- **WHEN** 用户创建普通草稿会话但尚未发送真实 provider 请求
- **THEN** 草稿继续保留在顶层 `chat`
- **AND** 页面刷新后仍能看到该草稿
- **AND** 后续真实请求仍复用该草稿编号

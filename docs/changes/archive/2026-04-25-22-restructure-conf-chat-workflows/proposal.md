## Why

当前项目级 `conf.json` 把会话编号、标题覆盖、草稿、工作流归属、模型状态和 UI 状态拆散到多个平铺字段中，导致 WebUI 会话、终端 Codex 会话和工作流内部会话容易出现编号不同步、可读性差和迁移困难的问题。

需要将配置重构为面向人类阅读的分组结构：顶层普通聊天统一放入 `chat`，工作流内部聊天统一放入 `workflows`，并把每个会话的编号、`sessionId`、标题、模型和 UI 状态聚合到同一个对象里。

## What Changes

- 引入 `conf.json` v2 schema：使用 `chat` 记录所有 standalone 会话，使用 `workflows` 记录网页端发起的工作流及其内部会话。
- 顶层 `chat` 采用 `"编号": {"sessionId","title","model","reasoningEffort","ui"}` 格式，统一管理 WebUI 手动会话和终端发起会话。
- `workflows` 采用 `"编号": {"title","chat"}` 格式，工作流 id 由编号推导为 `w<编号>`，不明文写入配置。
- 工作流内部 `chat` 复用顶层会话对象格式，但编号只在该 workflow 内部递增，不占用顶层 `chat` 编号。
- 草稿态必须先占用稳定编号和草稿 `sessionId`，真实请求完成后只替换同一条记录的 `sessionId`，不能重编号。
- 旧字段只作为 migration 输入读取：`manualSessionDrafts`、`sessionRouteIndex`、`sessionSummaryById`、`sessionWorkflowMetadataById`、`sessionModelStateById`、`sessionUiStateByPath` 等不再作为新写入格式。
- **BREAKING**：项目本地 `conf.json` 的主要会话配置结构改变；需要兼容旧配置读入并写回 v2。

## Capabilities

### New Capabilities

- `project-chat-config-v2`: 定义项目本地 `conf.json` 中 `chat` 与 `workflows` 的 v2 配置结构、编号规则、草稿生命周期和旧字段迁移行为。

### Modified Capabilities

- `project-workflow-control-plane`: 工作流内部会话必须从项目配置的 `workflows` 分组读取和展示，且工作流编号推导为 `w<编号>`。
- `codex-project-discovery`: 终端发起的 Codex 会话必须并入顶层 `chat` 编号空间，并以第一条用户指令作为默认标题。

## Impact

- 服务端项目配置读写：`server/projects.js` 中 `loadProjectConfig`、`saveProjectConfig`、会话标题、UI 状态、模型状态、草稿和 route index 相关 helper。
- 工作流控制面：工作流内部会话注册、读取、删除和展示逻辑。
- Codex 项目发现：终端会话导入时的编号和标题生成。
- API 行为：现有会话列表、会话改名、UI 状态、模型状态和草稿 finalize API 的外部行为保持不变，但底层配置写入 v2。
- 测试：需要新增验收测试覆盖 v2 写入、旧配置迁移、草稿 finalize、终端会话导入和工作流内部会话隔离。

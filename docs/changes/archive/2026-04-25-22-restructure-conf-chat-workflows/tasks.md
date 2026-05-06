## 1. 配置 Schema 与迁移层

- [x] 1.1 定义 `schemaVersion: 2` 的配置解析与序列化 helper，输出只包含 `chat`、`workflows` 和非会话项目配置字段。
- [x] 1.2 实现旧字段到 v2 的 migration：合并 `sessionRouteIndex`、`sessionSummaryById`、`manualSessionDrafts`、`sessionWorkflowMetadataById`、`sessionModelStateById` 和 `sessionUiStateByPath`。
- [x] 1.3 保存配置时停止写回旧会话字段，并确保 `sessionId` 只作为 value 字段出现。
- [x] 1.4 验收：`node --test tests/spec/test_project_chat_config_v2.js` 全部通过。

## 2. 顶层 Chat 编号与草稿生命周期

- [x] 2.1 将 WebUI 手动会话创建改为写入顶层 `chat["编号"]`，草稿 `sessionId` 使用稳定 `cN`。
- [x] 2.2 将普通草稿 finalize 改为原地替换 `chat["编号"].sessionId`，保留标题、模型、思考深度和 UI 状态。
- [x] 2.3 将删除逻辑改为删除对应 `chat["编号"]`，并保持编号 high-water 不回收。
- [x] 2.4 验收：`node --test tests/spec/test_project_chat_config_v2.js` 全部通过。

## 3. 工作流配置分组

- [x] 3.1 将工作流索引写入 `workflows["编号"]`，运行时 workflow id 统一由数字 key 推导为 `wN`。
- [x] 3.2 将工作流内部会话写入 `workflows["编号"].chat["内部编号"]`，按固定流程顺序编号。
- [x] 3.3 将工作流内部草稿 finalize 改为原地替换内部 chat 的 `sessionId`，并确保不会移动到顶层 `chat`。
- [x] 3.4 确保工作流内部会话不推进顶层普通会话编号。
- [x] 3.5 验收：`node --test tests/spec/test_project_workflow_control_plane_conf_v2.js` 全部通过。

## 4. 终端 Codex 会话导入

- [x] 4.1 将项目目录中扫描到的 standalone 终端 Codex 会话写入顶层 `chat`。
- [x] 4.2 为终端会话标题选择第一条真实用户指令，并保留现有 fallback。
- [x] 4.3 再次扫描同一 transcript 时通过 `sessionId` 去重，不重复分配编号。
- [x] 4.4 验收：`node --test tests/spec/test_codex_project_discovery_conf_v2.js` 全部通过。

## 5. 集成验证

- [x] 5.1 运行 `openspec/changes/22-restructure-conf-chat-workflows/test_cmd.sh`，确认全部验收测试通过。
- [x] 5.2 运行 `pnpm run typecheck`，确认 TypeScript 检查通过。
- [x] 5.3 手动检查一次迁移后的 `.ccflow/conf.json`，确认只有 `chat` / `workflows` 分组承载会话状态。

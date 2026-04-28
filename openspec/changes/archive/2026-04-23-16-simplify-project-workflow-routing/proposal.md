## Why

当前项目路由把绝对路径编码进 `/project/:projectId`，同时把工作流和会话暴露为不透明的真实 ID，并依赖 `provider`、`projectPath`、`workflowId` 等查询参数恢复上下文。这让 URL 难读、难分享，也让“项目 / 工作流 / 手动会话 / 工作流子会话”的层级关系在地址栏里不清晰。

这次需要把项目路由直接收敛为家目录相对路径，把工作流和会话收敛为稳定且不回收的 `wN/cN` 计数，并把 provider 与工作流归属等上下文落回相应 JSON/JSONL 持久化文件。这样可以显著降低路由复杂度，并为后续实现保持稳定链接语义。

## What Changes

- 把项目规范路由从 `/project/:projectId` 改为 `/<home-relative-path>`；当项目不在家目录下时，回退为完整绝对路径段。
- 为项目下的需求工作流、手动会话和工作流子会话引入稳定且不回收的顺序路由号，分别形成 `wN`、`cN` 和 `/<project>/wN/cN` 地址。
- 把 provider、工作流归属、阶段信息等上下文写回对应的 JSON/JSONL 持久化文件，路由恢复不再依赖这些查询参数。
- 更新前端路由解析、项目选择恢复、工作流详情跳转和测试，统一只生成新地址格式。
- **BREAKING**：不再兼容旧的 `/project/...`、`/session/:id?...` 地址和旧会话/旧工作流数据；旧数据若无法映射到新规则，可以不再展示。

## Capabilities

### New Capabilities

- `project-route-addressing`: 定义项目主页、工作流、手动会话和工作流子会话的规范 URL 语法，以及与持久化路由字段之间的对应关系。

### Modified Capabilities

- `project-workflow-control-plane`: 调整工作流详情页对子会话入口和跳转恢复的要求，使其遵循新的 `wN/cN` 路由规则并去除 URL 查询参数上下文依赖。

## Impact

- 前端路由与状态恢复：`src/App.tsx`、`src/components/app/AppContent.tsx`、`src/hooks/useProjectsState.ts`、`src/utils/projectRoute.ts`
- 工作流详情与会话跳转：`src/components/main-content/view/subcomponents/WorkflowDetailView.tsx`、`src/components/app/ProjectWorkspaceNav.tsx`
- 项目与工作流持久化：`server/projects.js`、`server/workflows.js`、相关 JSON/JSONL 读写逻辑
- 验收测试与文档：`tests/spec/project-route-addressing.spec.js`、`tests/spec/README.md`、`openspec/changes/2-simplify-project-workflow-routing/test_cmd.sh`

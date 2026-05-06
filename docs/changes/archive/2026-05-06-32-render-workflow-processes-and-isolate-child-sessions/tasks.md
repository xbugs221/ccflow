## 1. 后端 read model

- [x] 1.1 定义 `runnerProcesses` read-model 字段，覆盖 stage、role、status、sessionId、pid、exitCode、failed、logPath。
- [x] 1.2 从 Go runner `state.json` / `status --json` 的 `sessions`、`stages`、`paths` 降级构造 `runnerProcesses`。
- [x] 1.3 如果 runner contract 后续提供 `processes` 字段，优先使用该字段并保留降级逻辑。
- [x] 1.4 从 `runnerProcesses` 补齐 Go-backed workflow 的 `childSessions`，并保持 workflow 内 routeIndex 稳定。
- [x] 1.5 验收：后端单测覆盖 runner sessions 到 childSessions、runnerProcesses 的映射。

## 2. 前端工作流详情页

- [x] 2.1 扩展 `ProjectWorkflow` 类型，表达 `runnerProcesses`。
- [x] 2.2 在 `WorkflowDetailView` 渲染进程列表，显示 stage/status/thread/session/log 等真实字段。
- [x] 2.3 进程会话链接复用 workflow child route 跳转，不产生项目级手动会话入口。
- [x] 2.4 日志链接复用已有 artifact 文件打开逻辑。
- [x] 2.5 验收：工作流详情页测试覆盖进程列表、会话链接和日志链接。

## 3. 手动会话隔离

- [x] 3.1 抽出共享 `isWorkflowOwnedSession(project, session)` helper。
- [x] 3.2 项目主页手动会话列表使用共享 helper。
- [x] 3.3 项目内导航手动会话列表使用共享 helper。
- [x] 3.4 左侧栏手动会话列表使用共享 helper。
- [x] 3.5 路由解析禁止项目级 `/cN` 命中 workflow-owned session，但允许 `/wN/cM` 命中。
- [x] 3.6 验收：Playwright/Spec 测试覆盖三处手动会话列表均过滤 workflow-owned session。

## 4. 验收与回归

- [x] 4.1 使用 fake runner state 覆盖 execution/review/repair/archive 的状态映射。
- [x] 4.2 使用真实业务 E2E 验证启动 workflow 后，runner-owned session 只从详情页进入。
- [x] 4.3 运行 `pnpm typecheck`。
- [x] 4.4 运行相关 `tests/spec` 和 workflow e2e。

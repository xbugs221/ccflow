# Design: 工作流进程渲染与子会话隔离

## 源码事实

- `ProjectOverviewPanel`、`ProjectWorkspaceNav`、`SidebarProjectSessions` 都已用 `session.workflowId`、`session.stageKey` 或 `workflow.childSessions[].id` 过滤手动会话。
- `applyGoRunnerReadModel()` 当前把 runner state 映射到 `stageStatuses` 和 `artifacts`，但没有把 `runnerState.sessions` 映射到 `childSessions`。
- `WorkflowDetailView` 已能把 `stageInspections[].substages[].agentSessions` 渲染成会话链接，但依赖后端先提供 `childSessions`。
- `mc` 终端 checklist 的 pid/thread/exit 来自运行期 `stageRuntime`，现有 `State` 只持久化 `sessions`、`stages`、`paths` 等字段。

## 推断

- 用户看到的 bug 很可能不是单个 React 组件没有过滤，而是 Go runner 子会话没有进入 workflow read model，导致前端三处过滤逻辑都缺少归属证据。
- “参考现有 mc 工具”的进程列表应以阶段为行，展示状态和运行元数据，而不是另起一套任务面板。
- 若只在前端按 session title、路径或时间猜测归属，会误伤真实手动会话；归属必须来自后端 read model 或 runner state。

## 目标数据流

```text
mc state/status
  |
  |-- run_id / change_name / status / stage / stages
  |-- paths
  |-- sessions
  `-- processes?        (新增或可选)
       |
       v
server/workflows.js
  |
  |-- runnerState
  |-- runnerProcesses[]
  |-- childSessions[]
  |-- stageInspections[].substages[].agentSessions[]
  |
  v
React UI
  |
  |-- WorkflowDetailView: 阶段进程列表 + 子会话链接
  `-- 手动会话入口: 统一过滤 workflow-owned sessions
```

## Runner read model

建议在 ccflow read model 中增加稳定的 `runnerProcesses` 字段，即使底层 runner 暂时没有独立 `processes` 字段，也可从 `sessions` 和 `stages` 降级生成：

```json
{
  "runnerProcesses": [
    {
      "stage": "execution",
      "role": "executor",
      "status": "running",
      "sessionId": "codex-thread-id",
      "pid": "12345",
      "exitCode": null,
      "failed": false,
      "logPath": ".ccflow/runs/<run-id>/logs/executor.jsonl"
    }
  ]
}
```

字段规则：

- `stage` 使用 workflow stage key：`execution`、`review_1`、`repair_1`、`archive`。
- `role` 至少支持 `executor` 和 `reviewer`；repair 复用 executor thread 时仍以 stage 区分。
- `status` 来自 `runnerState.stages[stage]`，缺失时用当前 `runnerState.stage/status` 推断。
- `sessionId` 优先来自 runner 的 stage-scoped session；若只有 role-scoped `sessions.executor/reviewer`，允许映射到当前或已完成的对应阶段，但必须标注为 runner-owned。
- `pid`、`exitCode`、`failed` 为可选字段；没有稳定来源时前端隐藏对应列。
- `logPath` 从 `runnerState.paths` 解析，路径保持仓库相对 slash path。

## 子会话归一化

后端应从 `runnerProcesses` 派生 `workflow.childSessions`：

```text
runnerProcesses[]
  |
  +-- 有 sessionId
      |
      +-- 生成 childSession
            id: sessionId
            provider: codex
            workflowId: workflow.id
            stageKey: process.stage
            routeIndex: workflow 内部稳定编号
            title: stage label / role label
```

关键约束：

- 不用 session title 猜测工作流归属。
- 不因为同一个 session id 被 executor 在 execution/repair 复用而生成冲突的项目级手动会话。
- routeIndex 必须在同一 workflow 内稳定；刷新后 `/wN/cM` 不跳号。
- 如果已有 `workflow.childSessions`，以已有 routeIndex 为准，补齐缺失的 runner-owned sessions。

## 前端渲染

工作流详情页在阶段树附近增加“进程”视图：

```text
工作流详情
  |
  |-- Run: <run-id>  Status: running  Stage: review_1
  |
  |-- 进程
  |   |-- execution  completed  thread=...  log
  |   |-- review_1   running    pid=... thread=...  log
  |   `-- repair_1   pending
  |
  `-- 阶段树
      |-- 执行 -> 子会话链接
      `-- 初审 -> 子会话链接
```

交互规则：

- 有 `sessionId` 的进程行提供“查看会话”链接，调用现有 `onNavigateToSession()`，并传入 `workflowId`、`workflowStageKey` 和 provider。
- 有 `logPath` 的进程行提供日志文件链接，复用 `onOpenArtifactFile()`。
- 没有 session 或日志的 pending 行只展示状态，不做假链接。
- 详情页链接进入后必须落到 workflow child route。

## 手动会话过滤

把当前三处重复的 `isWorkflowChildSession()` 收敛为共享 helper：

```text
isWorkflowOwnedSession(project, session)
  |
  |-- session.workflowId 存在 -> true
  |-- session.stageKey 存在 -> true
  |-- workflow.childSessions 中存在同 provider + id -> true
  |-- workflow.runnerProcesses 中存在同 provider + sessionId -> true
  `-- false
```

注意：匹配应包含 provider，避免 Claude/Codex 同 id 时误过滤。

## 验收策略

### 后端单测

- fake Go runner state 包含 `sessions.executor`、`stages.execution`、`paths.executor_log`，workflow read model 应产生 `runnerProcesses` 和 `childSessions`。
- fake Go runner state 包含 review 阶段 thread，read model 应产生可路由 reviewer child session。
- 缺少 `processes` 字段时，系统仍从 `sessions/stages/paths` 降级展示 session/thread 和日志。

### 前端/路由测试

- 项目主页、项目内导航、左侧栏均不显示 runner-owned sessions。
- 工作流详情页显示进程列表，并能点击进程会话进入 `/wN/cM`。
- 直接访问项目级 `/cM` 不应解析到 workflow-owned session。

### 真实业务验收

```text
1. 创建一个 active OpenSpec change
2. 从项目主页启动 Go-backed workflow
3. 等待 runner 写入至少 execution thread
4. 项目主页“手动会话”不出现 execution thread
5. 工作流详情页“进程”显示 execution
6. 点击 execution 的会话链接进入 /wN/cM
7. 返回项目主页后，该会话仍不进入手动会话列表
```

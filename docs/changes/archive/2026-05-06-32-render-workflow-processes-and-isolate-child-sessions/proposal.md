# Proposal: 正确渲染 Go 工作流进程并隔离工作流子会话

## 背景

当前 Web 工作流已经迁移到 Go runner `mc` 推进，但前端详情页仍主要消费旧的 `stageStatuses`、`stageInspections`、`artifacts` 和 `childSessions` 结构。源码中已有多处尝试把工作流子会话从“手动会话”中过滤掉：

```text
项目手动会话入口
  |-- ProjectOverviewPanel
  |-- ProjectWorkspaceNav
  `-- SidebarProjectSessions

过滤依据
  |-- session.workflowId
  |-- session.stageKey
  `-- workflow.childSessions[].id
```

问题在于 Go-backed workflow 的真实状态来自 `.ccflow/runs/<run-id>/state.json`。当前后端把 runner state 映射成阶段状态和日志 artifacts，但没有把 `runnerState.sessions` 归一化为可路由的 `workflow.childSessions`，也没有把 `mc` 终端 checklist 中的 pid/thread/exit 进程元数据暴露给前端。因此前端过滤规则可能拿不到工作流归属证据，工作流发起的 Codex 会话会继续混入“手动会话”列表；详情页也无法像 `mc` 一样展示阶段进程列表。

## 变更目标

- 工作流详情页展示 Go runner 的阶段进程列表，至少能看出 stage、status、session/thread、日志入口；若 runner 提供 pid/exit/failed，也应渲染这些字段。
- Go-backed workflow 的 `runnerState.sessions` 必须进入 Web workflow read model，成为 `childSessions` 或等价的可路由子会话记录。
- 工作流发起的会话不得出现在项目主页、项目内导航、左侧栏的“手动会话”列表中。
- 工作流子会话只能通过工作流详情页中的阶段/进程链接进入，进入后 URL 保持在 `/wN/cM` 形式，而不是项目级 `/cM`。
- 保持 `.ccflow/runs/` 为运行态目录；本变更只读取已有 runner state，不在规划或测试准备阶段启动 sealed run。

## 非目标

- 不重写工作流详情页的整体树形视觉结构。
- 不恢复旧 Node auto-runner。
- 不让用户从手动会话列表删除、隐藏或批量操作工作流子会话。
- 不要求 ccflow 直接解析 Codex JSONL 作为 workflow 状态事实来源。
- 不在 ccflow 仓库 vendoring `mc` 或 `opsx`。

## 影响范围

- 后端 read model：`server/workflows.js` 的 Go runner state overlay 和 workflow normalize 流程。
- Go runner contract：若现有 `state.json`/`status --json` 没有进程列表，需要新增稳定字段或在 ccflow 侧定义降级映射。
- 前端类型：`ProjectWorkflow` 增加 runner process/read-model 字段，或复用 `stageInspections[].substages[].agentSessions`。
- 前端渲染：`WorkflowDetailView` 增加阶段进程列表；手动会话过滤逻辑抽成共享规则，避免三处 drift。
- 路由：工作流子会话跳转必须优先构造 workflow child route。
- 测试：补充 fake runner state、read-model 单测和 Playwright/Spec 回归。

## 已知约束

```text
事实来源
  |-- OpenSpec artifacts: docs/
  |-- Go runner sealed state: .ccflow/runs/<run-id>/state.json
  |-- Web project/workflow UI state: project .ccflow/conf.json
```

- 当前 `mc` 的持久 `State` 包含 `sessions: map[string]string`，保存 executor/reviewer thread id。
- 当前 `mc` 的 pid/thread/exit 是终端 checklist 的 transient runtime metadata，不在 ccflow 当前读取的 `state.json` 中稳定持久化。
- 如果产品要求刷新后仍展示 pid/exit/failed，必须由 runner JSON contract 或 ccflow 运行时事件缓存提供稳定字段。

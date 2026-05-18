# 设计

## 当前链路

前端创建自动工作流时，cbw 只启动 `wo`：

```text
WorkflowActionDialog
  -> POST /api/projects/:project/workflows
  -> createProjectWorkflow()
  -> startGoWorkflowRun()
  -> spawn("wo", ["run", "--change", name, "--json"])
  -> 读取 ${XDG_STATE_HOME}/wo/repos/.../runs/<run-id>/state.json
```

Codex/OpenCode/Pi 会话由 `wo` 内部发起，cbw 不直接创建这些 workflow agent 会话。cbw 的职责是把 `wo state.json` 转换成网页 read model。

## 根因

### 1. planner/planning key 不一致

`wo` 的角色表把规划阶段的 session role 定义为 `planner`，创建 run 时保存为：

```text
sessions["codex:planner"] = <planning-session-id>
```

cbw 当前 workflow read model 只检查：

```text
sessions.planning
sessions["codex:planning"]
```

这导致真实规划会话 id 可能被漏读。测试 fixture 还使用了 `codex:planning`，进一步掩盖了与真实 `wo` 契约的偏差。

### 2. sessions fallback 被伪造成 processes

`wo` 当前 JSON contract 主要稳定暴露 `sessions`、`stages`、`paths` 和 `error`。真实进程 pid 只是 `wo` 运行中的 transient runtime 信息，不在当前 runner DTO 中稳定输出。

cbw 的 `buildRunnerProcesses` 在没有 `state.processes` 时，会从 stage statuses、role session id 和 log path 合成 process rows。这样前端看到的“进程”区并不一定来自真实进程，里面的 `thread=<sessionId>` 容易被理解成进程编号。

### 3. pid 与 session id 含义混淆

pid 是本次 agent CLI 子进程编号，只在进程存在时有意义；session id 是 provider 会话编号，可用于打开对应会话上下文。二者生命周期不同：

```text
pid
  - 只代表当前系统进程
  - 进程结束后失效
  - 当前 wo JSON contract 未稳定持久化

session id
  - 代表 provider 会话/thread
  - 可用于前端进入 child session
  - 是否能 CLI resume 取决于 provider 本地索引
```

## 技术方案

### 规划会话解析

新增集中函数解析规划会话：

```text
resolvePlannerSessionRef(sessions, workflowConfig)
  1. <planning-tool>:planner
  2. codex:planner
  3. planner
  4. <planning-tool>:planning
  5. codex:planning
  6. planning
```

优先当前 `wo` 契约，兼容历史运行态。返回值应包含 `sessionId`、`provider`、`role=planner`、`stageKey=planning`。

### child session 构造

`childSessions` 应继续从两类来源构造：

- 真实 `processes[].sessionId`。
- `state.sessions` role map。

但 role map 只能生成会话入口，不能生成 process fact。规划会话地址保持 `/runs/<runId>/sessions/planning`，背后的 id 使用 provider session id。

### process 构造

将 `runnerProcesses` 收紧为真实 `state.processes`：

- 如果 `state.processes` 是非空数组，则按现有字段解析 `stage`、`role`、`status`、`sessionId`、`pid`、`exitCode`、`logPath`。
- 如果没有 `state.processes`，返回空数组。
- 不再从 `sessions` fallback 合成 process rows。

如果将来需要展示 pid，应推动 `wo` contract 明确输出 `processes`。cbw 在此之前只展示 sessions 和 stage，不猜 pid。

### 前端展示

workflow role summary：

- 规划行用 planner session ref 展示“会话”。
- 没有 planner session id 时显示 `未知`。

runner processes：

- 只有真实 `runnerProcesses.length > 0` 时展示“进程”区。
- process 行中 pid 和 session id 要分开显示：`pid=<pid>` 是进程编号，`thread=<sessionId>` 是会话编号。
- 没有 pid 时不得用 session id 代替 pid。

## 测试计划

- 更新 `tests/server/wo-workflow-contract.test.ts`：覆盖 `codex:planner`、legacy `codex:planning`、sessions-only 不产生 process rows、explicit processes 保留 pid。
- 更新 `tests/spec/project-workflow-control-plane.spec.ts` 和 fixture：将主路径从 `codex:planning` 改为 `codex:planner`。
- 新增前端业务 spec：打开 workflow 详情页，规划行可进入会话；没有 explicit processes 时不显示 runner process 区。
- 保留旧运行态兼容测试，避免历史 state 无法展示。

## 风险

- 一些旧测试依赖 sessions-only fallback 生成 process rows，需要按新语义更新。
- 如果用户期望看到实时 pid，本变更只会让 UI 不再误导；真正 pid 展示需要 `wo` 先扩展 JSON contract。
- 历史 `codex:planning` 运行态仍能显示，但不再作为 fixture 主路径。

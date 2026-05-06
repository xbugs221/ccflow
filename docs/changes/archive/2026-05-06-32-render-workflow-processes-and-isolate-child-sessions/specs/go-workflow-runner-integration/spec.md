## ADDED Requirements

### Requirement: Go runner 状态必须可映射为 Web 进程列表

系统 MUST 将 Go runner 的阶段运行状态映射成稳定的 Web workflow `runnerProcesses` read model，使前端无需解析 runner 终端输出即可展示阶段进程列表。

#### Scenario: 从 runner sessions 降级生成进程列表

- **WHEN** `.ccflow/runs/<run-id>/state.json` 包含 `sessions.executor`
- **AND** `stages.execution` 表示 execution 已启动或完成
- **THEN** workflow read model 包含 execution 进程行
- **AND** 该进程行包含 `stage: "execution"`、`role: "executor"`、`sessionId` 和状态

#### Scenario: 展示 runner 日志入口

- **WHEN** runner state 的 `paths` 包含某阶段角色的日志路径
- **THEN** 对应进程行包含仓库相对 slash `logPath`
- **AND** 前端可以把该路径作为日志文件链接展示

#### Scenario: 可选展示 pid 和退出码

- **WHEN** runner JSON contract 提供阶段进程的 `pid`、`exitCode` 或 `failed`
- **THEN** workflow read model 保留这些字段
- **AND** 前端展示已有字段
- **AND** 缺失字段不会生成空白假值或错误提示

### Requirement: Go runner 子会话必须进入 workflow read model

系统 MUST 将 Go runner 产生或恢复的 Codex session/thread 标记为 workflow-owned child session，而不是普通手动会话。

#### Scenario: execution thread 成为 workflow 子会话

- **WHEN** Go-backed workflow 的 runner state 包含 execution 的 executor session id
- **THEN** workflow read model 的 `childSessions` 包含该 session
- **AND** 该 child session 包含 `workflowId`、`stageKey: "execution"`、`provider: "codex"` 和稳定 `routeIndex`

#### Scenario: review thread 成为 workflow 子会话

- **WHEN** Go-backed workflow 进入 `review_1`
- **AND** runner state 包含 reviewer session id
- **THEN** workflow read model 的 `childSessions` 包含该 reviewer session
- **AND** 该 child session 的 `stageKey` 为 `review_1`

#### Scenario: 刷新后 routeIndex 稳定

- **WHEN** workflow read model 已经为 runner-owned child session 分配 `routeIndex`
- **AND** 用户刷新项目列表或重新打开工作流详情页
- **THEN** 同一个 child session 继续使用原 routeIndex
- **AND** 其 workflow child URL 不变化

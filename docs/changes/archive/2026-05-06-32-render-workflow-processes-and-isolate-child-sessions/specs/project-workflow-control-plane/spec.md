## ADDED Requirements

### Requirement: 工作流详情页必须展示 Go runner 进程列表

系统 MUST 在工作流详情页展示 Go-backed workflow 的阶段进程列表，让用户能看到每个阶段的运行状态、关联会话和日志入口。

#### Scenario: 工作流详情页显示阶段进程

- **WHEN** 用户打开 Go-backed workflow 详情页
- **AND** workflow read model 包含 `runnerProcesses`
- **THEN** 页面显示进程列表
- **AND** 每个进程行显示 stage 和 status
- **AND** 有 sessionId 的进程行提供会话链接
- **AND** 有 logPath 的进程行提供日志链接

#### Scenario: 点击进程会话进入 workflow child route

- **WHEN** 用户在工作流详情页点击某个 runner 进程的会话链接
- **THEN** 系统导航到该 workflow 下的 `/wN/cM` 子会话路由
- **AND** 不导航到项目级 `/cM` 手动会话路由

### Requirement: 手动会话列表必须排除工作流拥有的会话

系统 MUST 在所有手动会话入口排除 workflow-owned sessions，包括由 Go runner 发起或恢复的 Codex 会话。

#### Scenario: 项目主页不显示工作流子会话

- **WHEN** 项目存在 Go-backed workflow
- **AND** 该 workflow 的 read model 包含 runner-owned child session
- **THEN** 项目主页“手动会话”列表不显示该 session
- **AND** 该 session 仍可从 workflow 详情页进入

#### Scenario: 项目内导航不显示工作流子会话

- **WHEN** 用户打开项目内导航
- **AND** 项目存在 runner-owned child session
- **THEN** 项目内导航的“手动会话”分组不显示该 session

#### Scenario: 左侧栏不显示工作流子会话

- **WHEN** 用户展开左侧项目
- **AND** 项目存在 runner-owned child session
- **THEN** 左侧栏的“手动会话”分组不显示该 session

#### Scenario: 项目级会话路由不解析工作流子会话

- **WHEN** 用户直接访问项目级 `/cM`
- **AND** `cM` 对应的是 workflow-owned child session
- **THEN** 系统不把它解析为普通手动会话
- **AND** 用户必须通过 workflow 详情页或 `/wN/cM` 查看该会话

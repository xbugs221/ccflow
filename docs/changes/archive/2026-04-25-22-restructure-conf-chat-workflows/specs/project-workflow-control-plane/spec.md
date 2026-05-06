# project-workflow-control-plane Specification

## ADDED Requirements

### Requirement: 工作流会话配置必须存放在 workflows 分组内

系统 MUST 将网页端发起的工作流及其内部会话保存到项目 `conf.json` 的 `workflows` 分组，并从 workflow 数字 key 推导运行时 workflow id。

#### Scenario: 新建工作流时使用数字 key 推导 wN

- **WHEN** 用户在 WebUI 中创建项目的第一个工作流
- **THEN** 系统写入 `workflows["1"]`
- **AND** 运行时代码将该工作流推导为 `w1`
- **AND** 配置文件中不明文写入 `workflowId`

#### Scenario: 工作流内部会话按流程顺序编号

- **WHEN** 工作流依次创建 planning、execution 和 verification 内部会话
- **THEN** 系统在同一个 `workflows["<编号>"].chat` 中写入 `"1"`、`"2"` 和 `"3"`
- **AND** 每个内部会话记录包含 `sessionId`、`title`、`model`、`reasoningEffort` 和 `ui`
- **AND** 这些内部编号不占用顶层 `chat` 编号

### Requirement: 工作流内部草稿必须保留在 workflow chat 中 finalize

系统 MUST 在工作流内部会话真实创建前写入 workflow 内部草稿记录，并在真实 sessionId 返回后原地替换。

#### Scenario: 工作流内部草稿 finalize

- **WHEN** 工作流创建一个内部草稿会话
- **THEN** 系统写入 `workflows["<工作流编号>"].chat["<内部编号>"].sessionId` 为草稿 id
- **WHEN** provider 返回真实 session id
- **THEN** 系统只替换同一条内部 chat 记录的 `sessionId`
- **AND** 该内部会话不会移动到顶层 `chat`

#### Scenario: 工作流内部会话不推进手动会话编号

- **WHEN** 一个工作流已经创建两个内部会话
- **AND** 顶层 `chat` 为空
- **AND** 用户在 WebUI 新建普通会话
- **THEN** 系统创建 `chat["1"]`
- **AND** 系统不会因为工作流内部会话而创建 `chat["3"]`

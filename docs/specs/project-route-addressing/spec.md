## Purpose

定义 CCUI 中项目、工作流、手动会话与工作流子会话的规范路由格式，以及刷新时的上下文恢复方式。

## Requirements

### Requirement: 项目主页必须使用家目录相对路径作为规范地址

系统 MUST 将项目主页的规范地址定义为 `/<home-relative-path>`，不得再使用 `/project` 公共前缀或绝对路径编码作为项目主页主入口；若项目不在家目录下，系统 MUST 使用完整绝对路径作为项目路径段。

#### Scenario: 进入家目录下项目的项目主页
- **WHEN** 用户打开一个位于家目录下的项目主页
- **THEN** 地址栏显示 `/<home-relative-path>`
- **AND** 地址中不包含 `/project/`
- **AND** 页面仍然展示该项目的项目主页内容

### Requirement: 工作流使用 runId 路由，手动会话使用稳定且不回收的计数路由号

系统 MUST 为 Go-backed 工作流使用 `.ccflow/runs/<run-id>/state.json` 中的 `runId` 生成稳定地址，为项目手动会话分配稳定且不回收的 `cN` 路由号，并为工作流子会话生成 `/<project>/runs/<runId>/sessions/<stage>` 形式的地址。系统 MUST 直接从 runner state 或项目本地会话配置读取这些标识，而不是根据当前排序临时计算。

#### Scenario: 打开项目中的 Go-backed 工作流
- **WHEN** 用户从项目主页进入该项目中一个 mc 工作流
- **THEN** 地址栏显示 `/<project>/runs/<runId>`
- **AND** `runId` 来自 `.ccflow/runs/<runId>/state.json`

#### Scenario: 打开项目中的第一个手动会话
- **WHEN** 用户从项目主页进入该项目中第一个已持久化编号的手动会话
- **THEN** 地址栏显示 `/<project>/c1`
- **AND** 地址中不暴露真实会话 ID

#### Scenario: 从工作流详情进入 runner-owned 子会话
- **WHEN** 用户从 `/<project>/runs/<runId>` 进入该工作流的 execution 子会话
- **THEN** 地址栏显示 `/<project>/runs/<runId>/sessions/execution`
- **AND** 系统使用 runner state 中的阶段或角色恢复真实 provider session

### Requirement: 路由恢复必须依赖持久化上下文而不是 URL 查询参数

系统 MUST 将 provider、所属项目、所属工作流、阶段和子阶段等恢复上下文写入对应会话或工作流的 JSON/JSONL 持久化文件。系统 MUST 在刷新或重新打开页面时仅凭规范路径和持久化数据恢复当前页面，不得要求 URL 附带 `provider`、`projectPath`、`workflowId` 或同类查询参数。

#### Scenario: 刷新工作流子会话页面
- **WHEN** 用户打开 `/<project>/runs/<runId>/sessions/execution` 并刷新页面
- **THEN** 系统仍然恢复到同一个工作流子会话
- **AND** 地址中不出现 `provider`、`projectPath`、`workflowId` 等查询参数
- **AND** 页面使用持久化数据恢复正确的 provider 和工作流归属

## 新增需求

### Requirement: 工作流列表必须展示已接管的外部 mc run

系统 MUST 在项目 workflow 列表中展示从 `.ccflow/runs/*/state.json` 接管的外部 `mc` run，使用户能从 Web UI 查看其他终端启动或完成的工作流。

#### Scenario: 列表展示外部运行中工作流
- **WHEN** 用户在其他终端启动 `mc`
- **AND** 该 run 已写入 `.ccflow/runs/<run-id>/state.json`
- **AND** 用户打开或刷新项目 workflow 列表
- **THEN** 列表 MUST 显示该 workflow
- **AND** 该 workflow MUST 显示为 Go runner-backed running 状态

#### Scenario: 列表展示外部已完成工作流
- **WHEN** 外部 `mc` run 的 state 为 done 或 completed
- **AND** 该 run 未通过 Web UI 创建 workflow
- **THEN** 项目 workflow 列表 MUST 仍显示该 completed workflow
- **AND** 用户 MUST 能进入详情页查看 runner state 和 artifact 链接

#### Scenario: 接管后 route 稳定
- **WHEN** 外部 run 第一次被 workflow 列表发现
- **AND** 用户刷新页面或重启 ccflow 服务
- **THEN** 该 workflow 的 `/wN` route MUST 保持稳定
- **AND** 系统 MUST NOT 因重复 discovery 创建重复 workflow 卡片

#### Scenario: 详情页展示接管来源
- **WHEN** 用户打开外部 run 对应的 workflow 详情页
- **THEN** 详情页 MUST 展示 run id、OpenSpec change、当前 stage 和 runState
- **AND** 系统 SHOULD 提供该 workflow 来自外部 `mc` run 接管的诊断信息

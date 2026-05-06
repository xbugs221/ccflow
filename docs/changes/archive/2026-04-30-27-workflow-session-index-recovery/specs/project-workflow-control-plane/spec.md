## MODIFIED Requirements

### Requirement: 需求工作流详情必须展示控制面阶段与子会话入口

系统 MUST 把需求工作流详情页作为控制面展示：包含工作流标题、目标、阶段状态、阶段产物、内部会话入口，以及内部会话索引异常和恢复状态。

#### Scenario: 控制面工作流详情展示阶段与子会话入口

- **WHEN** 用户查看某工作流详情页
- **THEN** 系统展示阶段树
- **AND** 每个阶段展示状态、关键产物、是否已关联内部会话
- **AND** 已有关联内部会话的阶段提供进入该会话的入口
- **AND** 尚未开始的阶段展示下一步动作提示

#### Scenario: 控制面展示内部会话索引异常

- **WHEN** auto-runner 检测到某阶段存在内存 action key 但 workflow 内部会话索引缺失
- **THEN** 工作流详情 read model MUST 展示该阶段的索引异常提示
- **AND** 提示 MUST 区分 `index_missing`、`index_stale`、`orphan_ambiguous`、`orphan_quarantined`
- **AND** 提示 MUST 不得伪装成阶段已完成

#### Scenario: 控制面展示恢复后的内部会话

- **WHEN** 系统从 provider orphan 会话恢复出 workflow 内部会话索引
- **THEN** 工作流详情 read model MUST 展示恢复后的内部会话入口
- **AND** 该阶段 MUST 展示 `orphan_recovered` 恢复记录
- **AND** 系统 MUST 不得再为同一 action 自动创建第二个内部会话

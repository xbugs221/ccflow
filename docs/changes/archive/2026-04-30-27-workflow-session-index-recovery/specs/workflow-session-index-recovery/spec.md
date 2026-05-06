## ADDED Requirements

### Requirement: 自动 runner 必须以持久化索引校验内存去重

系统 MUST 在使用 `inFlightKeys` 或 `completedKeys` 跳过 workflow action 前，校验当前 workflow 控制面仍存在匹配该 action 的内部会话索引。

#### Scenario: completedKey 存在但 child session 索引缺失

- **WHEN** `completedKeys` 包含 `w1` 的 `planning` action key
- **AND** workflow 的 `chat` 和 `childSessions` 中没有 `planning` 内部会话
- **THEN** 系统 MUST 不得因为该 completed key 跳过 action
- **AND** 系统 MUST 将该 action 标记为索引缺失并进入恢复或重建流程

#### Scenario: completedKey 存在且 child session 索引有效

- **WHEN** `completedKeys` 包含 `w1` 的 `planning` action key
- **AND** workflow 的 `chat` 或 `childSessions` 中存在匹配 `planning` 的内部会话
- **THEN** 系统 MUST 跳过重复启动
- **AND** 系统 MUST 保持现有内部会话索引不变

### Requirement: 索引缺失时必须先尝试恢复 provider orphan 会话

系统 MUST 在重建内部会话前扫描当前项目的 Claude Code / Codex CLI 固定会话存储，并尝试恢复未登记但高置信匹配当前 workflow action 的 provider 会话。

#### Scenario: 找到唯一高置信 orphan 会话

- **WHEN** workflow 缺少 `execution` 内部会话索引
- **AND** provider 会话存储中存在唯一一个未登记会话
- **AND** 该会话属于当前项目并匹配 workflow id、stage key 或 workflow title
- **THEN** 系统 MUST 将该 provider session id 补写到 workflow 内部会话索引
- **AND** 系统 MUST 不得创建新的内部会话
- **AND** 系统 MUST 记录 `orphan_recovered` 控制器事件

#### Scenario: 多个可疑 orphan 会话无法唯一绑定

- **WHEN** workflow 缺少 `planning` 内部会话索引
- **AND** provider 会话存储中存在多个未登记候选
- **THEN** 系统 MUST 不得自动选择其中任意一个补写索引
- **AND** 系统 MUST 记录 `orphan_ambiguous` 控制器事件
- **AND** 系统 MUST 只允许后续隔离或人工处理后重建

### Requirement: 重建前必须隔离未登记可疑 provider 会话

系统 MUST 在创建新的内部会话前，隔离当前项目内未被任何 workflow 明确登记且匹配当前 workflow action 的可疑 provider 会话。

#### Scenario: 隔离未登记候选但保留已登记会话

- **WHEN** 当前项目存在一个未登记 Codex 候选会话
- **AND** 同项目还存在一个已登记到其他 workflow 的 Codex 会话
- **THEN** 系统 MUST 只隔离未登记候选
- **AND** 系统 MUST 不得移动、删除或改写已登记会话
- **AND** 系统 MUST 为隔离动作写入 manifest

#### Scenario: 没有可疑 provider 会话时直接允许重建

- **WHEN** workflow 缺少当前 stage 的内部会话索引
- **AND** provider 会话存储中没有匹配当前项目和 action 的未登记候选
- **THEN** 系统 MUST 清除对应 action 的内存去重状态
- **AND** 系统 MUST 允许 auto-runner 创建新的内部会话
- **AND** 系统 MUST 记录 `session_rebuild_allowed` 控制器事件

### Requirement: 恢复过程必须对工作流控制器可见

系统 MUST 将内部会话索引异常和恢复动作写入 workflow 控制面，并在 workflow read model 中返回。

#### Scenario: 索引缺失被检测到

- **WHEN** auto-runner 发现内存 action key 存在但 workflow 内部会话索引缺失
- **THEN** workflow read model MUST 包含 `index_missing` 类型的控制器事件或 stage warning
- **AND** 事件 MUST 包含 `stageKey`、`provider`、`message` 和 `createdAt`

#### Scenario: orphan 会话被隔离后允许重建

- **WHEN** 系统隔离未登记 provider 会话后创建新的内部会话
- **THEN** workflow read model MUST 同时暴露 `orphan_quarantined` 和 `session_rebuilt` 记录
- **AND** 新会话 MUST 写入 workflow 内部会话索引

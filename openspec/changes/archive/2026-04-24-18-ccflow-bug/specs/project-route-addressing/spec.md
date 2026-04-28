## MODIFIED Requirements

### Requirement: 路由恢复必须依赖持久化上下文而不是 URL 查询参数

系统 MUST 将 provider、所属项目、所属工作流、阶段和子阶段等恢复上下文写入对应会话或工作流的 JSON/JSONL 持久化文件。系统 MUST 在刷新或重新打开页面时仅凭规范路径和持久化数据恢复当前页面，不得要求 URL 附带 `provider`、`projectPath`、`workflowId` 或同类查询参数。对于工作流子会话地址 `/<project>/wN/cN`，系统 MUST 仅使用该地址所指向的 workflow child session 作为消息恢复来源，不得复用前一个工作流子会话遗留的聊天状态。

#### Scenario: 刷新工作流子会话页面

- **WHEN** 用户打开某个工作流子会话地址并刷新页面
- **THEN** 页面 MUST 仍然停留在同一个 `/<project>/wN/cN` 地址
- **AND** 页面 MUST 仅根据持久化上下文恢复该工作流子会话
- **AND** URL MUST NOT 依赖 `provider`、`projectPath`、`workflowId` 等查询参数

#### Scenario: 从一个工作流子会话切换到新创建的工作流子会话

- **WHEN** 用户当前位于 `/<project>/w1/c1` 并已加载该子会话消息
- **AND** 用户创建新的需求工作流并进入 `/<project>/w2/c1`
- **THEN** 页面 MUST 使用 `w2/c1` 对应的持久化会话恢复聊天视图
- **AND** 页面 MUST NOT 继续展示 `w1/c1` 的历史消息
- **AND** 用户刷新 `/<project>/w2/c1` 后仍 MUST 看到 `w2/c1` 自己的消息或空白初始态

# 修正 co 续发会话路由身份规格

### 需求：续发消息必须使用稳定 route conversation_id

ccflow 写入 `co` message request 时，必须使用稳定的 `cN` route 作为 `conversation_id`，不得使用 provider session id。

#### 场景：浏览器显式提供 ccflowSessionId

- **给定** 浏览器发送 Codex 或 OpenCode 消息并带有 `ccflowSessionId = "c51"`
- **当** ccflow 写入 `co` request
- **则** pending request 的 `conversation_id` 必须是 `"c51"`
- **且** 不得被 `sessionId` 或 `provider_session_id_hint` 覆盖

#### 场景：浏览器只提供 provider session id

- **给定** 项目配置或 `co` conversation state 能把 provider session id 反查到 `conversation_id = "c51"`
- **当** 浏览器发送续发消息时只带 provider session id
- **则** ccflow 必须写入 `conversation_id = "c51"`
- **且** WebSocket 回流事件仍带 `ccflowSessionId = "c51"`

#### 场景：provider session id 无法反查 route

- **给定** 浏览器发送续发消息时只带 provider session id
- **且** 后端无法从项目配置或 `co` state 找到对应 `cN`
- **当** ccflow 处理该请求
- **则** 请求必须失败并返回清楚错误
- **且** 不得向 `requests/pending/` 写入 request 文件

### 需求：abort request 必须使用相同 route 身份

用户中止运行中的 co turn 时，abort request 必须使用与 message request 相同的 `conversation_id` 解析规则。

#### 场景：从 provider session id 发起 abort

- **给定** 当前 UI 只持有 provider session id
- **且** 后端可反查到 `conversation_id = "c51"`
- **当** 用户点击停止
- **则** ccflow 写入的 abort request 必须使用 `conversation_id = "c51"`
- **且** `target_turn_id` 保持为 UI 观察到的 active turn id

### 需求：OpenCode co 会话必须显示用户消息气泡

OpenCode 会话从 co durable state 回读时，必须把 request 文本还原成用户消息，而不是只显示 assistant event。

#### 场景：turn 目录没有 request.json 但 state.json 有 request_id

- **给定** co conversation `c49` 的 provider 是 `opencode`
- **且** `requests/done/<request>.json` 中存在 `text = "ping"`
- **且** `turns/<turn>/state.json` 中存在同一个 `request_id`
- **且** `turns/<turn>/events.jsonl` 中存在 `opencode-response`
- **当** 前端请求 `/api/projects/:projectName/sessions/c49/messages?provider=opencode`
- **则** 响应必须先包含 `role = "user"` 且 `content = "ping"` 的消息
- **并且** 后续包含对应 assistant 回复

#### 场景：两轮 OpenCode 消息都可回读

- **给定** 同一个 OpenCode conversation 有两条 request，文本分别为 `"ping"` 和 `"ping2"`
- **且** 两个 turn 都通过 `state.json.request_id` 关联 request
- **当** cbw 读取该会话消息
- **则** transcript 顺序必须是 user `"ping"`、assistant、user `"ping2"`、assistant
- **并且** 第二条 user 消息不得被吞掉

### 需求：发送中的 OpenCode user 消息不得在刷新时消失

当 OpenCode request 被 co daemon 认领但尚未完成时，cbw 仍应保留用户刚发送的消息。

#### 场景：request 位于 claimed 桶

- **给定** OpenCode request 已从 pending 移入 `requests/claimed`
- **且** turn state 已记录 `conversation_id` 和 `request_id`
- **当** 聊天页刷新或重新加载 session messages
- **则** API 响应必须包含该 request 的 user 消息
- **且** 前端不得把已显示的 optimistic user bubble 清除

#### 场景：request 位于 running 桶

- **给定** OpenCode request 仍在 `requests/running`
- **当** cbw 读取 co conversation messages
- **则** user 消息必须可见
- **且** assistant event 尚未到达时 transcript 可以只有 user 消息

### 需求：durable user 消息与 optimistic 气泡必须去重

前端发送后立即展示的用户气泡，与 co durable request 回读出的用户消息代表同一次发送时，只能显示一条。

#### 场景：durable request 确认 optimistic bubble

- **给定** 前端已显示一条 optimistic user bubble `"ping2"`
- **且** session messages 随后返回同一 request 的 durable user message `"ping2"`
- **当** 前端合并消息
- **则** 聊天区只显示一条 `"ping2"` 用户气泡
- **并且** 该气泡不再标记为 pending 或 failed

#### 场景：真实重复发送不能被误删

- **给定** 用户连续两次发送相同文本 `"ping"`
- **且** 两次 request id 不同
- **当** durable transcript 回读完成
- **则** 聊天区必须显示两条独立的 user 消息

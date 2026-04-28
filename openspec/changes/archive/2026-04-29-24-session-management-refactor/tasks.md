## 1. 会话索引与草稿绑定

- [x] 1.1 新增 ccflow 会话索引读写模块，支持按项目持久化 `ccflow_session_id`、provider、provider session id、状态、事件和 provider offset。
- [x] 1.2 将手动会话草稿 `c1/c2` 初始化为索引记录，并保留现有简化路由编号不变。
- [x] 1.3 为首条消息启动写入 `pending_start`、`start_request_id` 和 `client_ref`，保证 provider 启动前已有可恢复记录。
- [x] 1.4 实现 `ccflow_session_id + start_request_id` 的 provider session 原子绑定，拒绝 stale request 和重复覆盖。
- [x] 1.5 兼容没有索引记录的旧草稿和旧 provider session 历史读取。
- [x] 1.6 验收：`node --test tests/spec/test_session_management_refactor.js` 中 Stable ccflow session identity、Concurrent draft binding safety、Pending session recovery 相关用例通过。

## 2. 后端聊天启动与事件索引

- [x] 2.1 调整首条消息 WebSocket/API 协议，要求传递 `ccflow_session_id`、`start_request_id` 和 `client_ref`。
- [x] 2.2 在 Claude/Codex provider job context 中透传 ccflow 会话身份，provider 返回真实 session id 时由后端绑定索引。
- [x] 2.3 为会话事件追加单调 `event_seq`，区分事件顺序和 `message_id`。
- [x] 2.4 将 provider stream 输出转换为 ccflow `message.updated` 事件，并记录 `message_id`、`revision` 和 provider session 信息。
- [x] 2.5 实现断线重连按 `event_seq` replay，缓存不足时返回全量校准信号。
- [x] 2.6 验收：`node --test tests/spec/test_session_management_refactor.js` 中 Indexed realtime events 相关用例通过。

## 3. 前端会话状态与幂等合并

- [x] 3.1 移除新会话真实 session 绑定对全局 `pendingSessionId`、`pendingDraftSessionId`、`pendingSessionClientRequestId` 的依赖。
- [x] 3.2 前端按 `ccflow_session_id` 过滤 WebSocket 事件，非当前会话事件只更新列表或后台状态。
- [x] 3.3 前端按 `event_seq` 去重，并按 `message_id + revision` 合并消息投影。
- [x] 3.4 刷新或切换回 `c1` 时从索引恢复 pending、running、failed 或 bound 状态。
- [x] 3.5 验收：`node --test tests/spec/test_session_management_refactor.js` 中 pending 恢复和 duplicate event replay 相关用例通过。

## 4. 历史校准与 provider jsonl 只读

- [x] 4.1 保持 Claude/Codex 原生 jsonl 只读，不写入 ccflow 自定义字段。
- [x] 4.2 记录 provider transcript path、line、offset 或 provider event id 到 ccflow 索引。
- [x] 4.3 实现 provider 历史到 ccflow 消息投影的增量校准。
- [x] 4.4 实时消息和历史消息冲突时，用索引中的更高 revision 覆盖投影，避免重复消息。
- [x] 4.5 验收：`node --test tests/spec/test_session_management_refactor.js` 中 Provider transcript preservation 相关用例通过。

## 5. Steer 干预

- [x] 5.1 为运行中 steer 新增 intervention 记录，包含 `intervention_id`、`message_id`、内容、状态和目标会话。
- [x] 5.2 在 Claude Code/Codex CLI 原生工具调用后安全边界注入 steer。
- [x] 5.3 将 steer 状态从 `accepted` 推进到 `queued`、`injected` 或 `failed`，并广播对应消息更新。
- [x] 5.4 会话已完成或 provider 拒绝时，将 steer 标记为失败，不创建新的普通 turn。
- [x] 5.5 验收：`node --test tests/spec/test_session_management_refactor.js` 中 Native steer intervention tracking 相关用例通过。

## 6. 集成验证

- [x] 6.1 更新 `openspec/changes/24-session-management-refactor/test_cmd.sh` 指向本变更验收测试。
- [x] 6.2 运行 `openspec/changes/24-session-management-refactor/test_cmd.sh`，确认实现完成后所有验收测试通过。

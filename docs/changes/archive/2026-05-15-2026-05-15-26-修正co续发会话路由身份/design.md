# 修正 co 续发会话路由身份设计

## 现状问题

发送路径里的 `conversationId` 回退链过宽：如果 `ccflowSessionId` 为空，会把 provider session id 写进 `conversation_id`。这会让 `co` 创建一个新 conversation，而不是续接原来的 `cN` conversation。

## 设计

新增一个后端解析函数，集中得到 co request 使用的 conversation id：

- 输入：provider、WebSocket payload、resolvedOptions、projectName、projectPath。
- 优先使用显式 `ccflowSessionId` / `ccflow_session_id`。
- 如果当前 `sessionId` 已经是 `cN`，直接使用它。
- 如果当前 `sessionId` 是 provider session id，先从项目 chat 配置按 session id 找 routeIndex，得到 `c<routeIndex>`。
- 如果项目配置没有命中，再扫描 `co` conversation state，按 `provider_session_id` 反查 `conversation_id`。
- 仍然找不到时返回业务错误，调用方不得写 pending request。

Codex、OpenCode 和 abort 三条写 co request 的路径都必须使用这个解析结果。`provider_session_id_hint` 仍可保留给协议兼容，但不能决定 `conversation_id`。

## 测试策略

- 新增 WebSocket 级测试：浏览器只传 provider session id，项目或 co state 能反查 `c51` 时，pending request 的 `conversation_id` 必须是 `c51`。
- 新增拒绝测试：浏览器只传 provider session id，后端无法反查 route 时，应返回 provider error，并且 `requests/pending/` 不出现新文件。
- 覆盖 Codex 和 OpenCode 的共用解析逻辑，避免只修一条 provider 路径。
- 覆盖 abort request，确保 stop 操作也使用 `cN` conversation id。

## 风险

- 历史项目配置里可能存在 provider session id 但缺少 routeIndex；需要使用现有 `co` state 作为兼容反查。
- WebSocket payload 字段来源较多，必须把解析逻辑集中，避免继续散落 fallback。

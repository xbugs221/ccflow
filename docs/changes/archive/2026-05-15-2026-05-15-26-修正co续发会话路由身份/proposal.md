# 修正 co 续发会话路由身份提案

## 背景

ccflow 通过 `co-request-v1` 文件协议把 Codex/OpenCode 手动聊天请求交给 `co`。协议里 `conversation_id` 应该是稳定的 ccflow 路由身份，例如 `c51`；provider 真实会话 id 应该由 `co` 写入 conversation state 的 `provider_session_id`。

当前发送路径在缺少 `ccflowSessionId` 时，会退回使用 `codexOptions.sessionId`、`opencodeProviderOptions.sessionId` 或 `data.sessionId` 作为 `conversation_id`。当这些字段是真实 provider session id 时，`co` 会把它当成一个新的 conversation，续发消息就会分叉成两个会话。

## 目标

- 保证 ccflow 写入 `co` 的 message/abort request 时，`conversation_id` 始终是稳定的 ccflow 路由 id。
- 当浏览器只带 provider session id 时，后端必须从项目配置或 `co` conversation state 反查原始 `cN` route。
- 反查失败时必须拒绝发送，并且不得写入 `requests/pending/`。
- 保持现有 `co` 事件回流、reconnect replay 和 `message-accepted` 行为不倒退。

## 非目标

- 不改变 `co-request-v1`、`co-conversation-v1`、`co-turn-v1` 字段名。
- 不把 provider session id 作为新的 ccflow route。
- 不在 ccflow 内直接调用 Codex/OpenCode 绕过 `co`。

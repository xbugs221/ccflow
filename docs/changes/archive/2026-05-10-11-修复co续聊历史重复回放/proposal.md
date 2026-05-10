## 背景

前端打开 `c51` 这类 co 手动会话后，如果不强刷页面，在同一个会话里续发消息会重复显示很多之前的会话信息。

当前观察到的链路：

```text
打开 /projects/ccflow/c51
  |
  +-- REST 加载 provider session 持久历史
  |
  +-- WebSocket 发送 check-session-status
        |
        +-- 后端发现 c51 是 idle co conversation
        |
        +-- replayCoConversationEvents 回放所有历史 turn events
              |
              +-- 前端把历史 codex-response 当成新的实时消息 append
```

用户可见结果是旧回复重复出现，例如 `CO_QUEUE_1_OK`、`CO_QUEUE_2_OK`、`CO_QUEUE_3_OK` 或上一轮 `问：ping / 答：pong` 被再次插入当前消息列表。强刷页面后只剩 REST 历史，因此看起来问题只发生在同页续聊或状态刷新期间。

## 目标

- idle 的 co 会话状态检查不得把完整历史事件当实时事件再次推给前端。
- 前端消费 co/Codex 实时消息必须具备幂等性，同一个历史消息不能因 WebSocket 重放重复显示。
- `cN` 手动会话路由编号和 provider session id 的职责要清晰，避免 `c51` 同时被当作临时会话和稳定路由会话导致过滤逻辑混乱。
- 续聊时新一轮消息仍能实时显示，历史校准仍以 provider JSONL 或 co 持久状态为准。

## 范围

```text
server/index.js
  check-session-status
  replayCoConversationEvents
  co event broadcast / replay contract

src/components/chat/hooks/
  useChatRealtimeHandlers.ts
  useChatSessionState.ts

shared/
  socket-message-utils.js 或新增轻量幂等 helper

docs/changes/11-修复co续聊历史重复回放/tests/
  执行阶段写入真实 server/front-end/e2e 测试代码
```

执行阶段应先复现 `c51` 或 fixture co conversation 的重复链路，再选择最小修复。优先修正“idle 状态检查全量 replay 历史事件”的后端行为；前端幂等作为必要防线，避免未来断线补发或多连接场景再次产生重复。

## 非目标

- 不重新设计整个聊天协议。
- 不改变 Codex JSONL 文件格式。
- 不移除 co conversation/turn 持久化。
- 不调整聊天 UI 样式。
- 不处理与本问题无关的 dock、侧边栏、文件树布局。
- 不创建 `.wo/runs/` 运行态文件，不启动 sealed run。

## 测试意图

执行阶段需要新增真实测试，覆盖用户可感知行为，而不是只检查组件是否渲染：

- server 测试：构造 idle co conversation，发送 `check-session-status`，断言不会重放历史 `codex-response agent_message`。
- 前端业务测试：已存在持久历史时，再注入同一批历史 replay 事件，断言旧 assistant 消息只显示一次。
- e2e 测试：在 fixture co home 下打开 `c51` 类手动会话，连续发送两轮消息且不刷新页面，断言每轮 user/assistant 消息只出现一次。

## 开放问题

- 是否仍需要支持断线期间的历史补发？如果需要，应改成带 cursor/last-event-id 的补发，而不是 idle 时全量 replay。
- Codex live `agent_message` 是否继续实时显示，还是统一等 JSONL 落盘后通过历史校准显示？本提案默认保留实时显示，但要求有稳定 identity 去重。

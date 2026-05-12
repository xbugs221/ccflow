## 背景

用户在 ccflow 网页端同一会话里发送第 2 条消息时，消息本身可以提交出去，但前端收不到智能体响应。这个现象和之前“co 续聊历史重复回放”相反：那次是旧响应重复出现，这次是新响应没有进入当前页面。

当前链路是：

```text
Browser send #2
  |
  v
ccflow WebSocket
  |
  +-- 写入 co requests/pending/<request>.json
  +-- 读取 conversations/<cN>/state.json
  +-- observeCoConversationTurns(cN)
  +-- tail turns/<turn>/events.jsonl
  |
  v
Browser codex-response / opencode-response
```

只读排查显示，ccflow 已有 `observeCoConversationTurns`、`recoverCoConversation` 和 co 事件转发逻辑，但缺少能证明“同一 `cN` 页面连续发送两条消息时，第 2 个 turn 的 agent response 必须实时显示”的业务测试。问题可能发生在 ccflow 未及时发现新 `active_turn_id`、未 tail 新 turn、事件缺少 `ccflowSessionId` 导致前端过滤掉，或前端去重/状态过滤误丢第 2 轮响应。

如果执行阶段证明 co 没有为第 2 个 turn 正确写出响应事件，则同步执行 `../co` 的配套提案 `3-保障续发turn事件回流`。

## 目标

- 优先修复 ccflow 网页端同一会话第 2 条消息收不到智能体响应的问题。
- 确保第 2 条及后续消息在同一 `cN` 页面实时显示 assistant response。
- 保证 REST 历史、WebSocket 实时事件、session-status 轮询三者不互相覆盖或误过滤新响应。
- 用真实业务测试覆盖连续续发，不只检查组件存在。
- 若根因在 `../co`，保留清晰证据并通过 co 配套提案修复。

## 变更范围

```text
server/index.js
  +-- co request accepted 后的 conversation 观察
  +-- 新 active_turn_id 发现与 tail 绑定
  +-- broadcast 事件补齐 ccflowSessionId / turnId

server/co-client.js
  +-- co state/events 读取与事件合法性边界

src/components/chat/hooks/useChatRealtimeHandlers.ts
  +-- 当前 cN 路由过滤
  +-- codex-response / opencode-response 去重与追加
  +-- session-status 对 loading/abort 状态的影响

src/components/chat/hooks/useChatComposerState.ts
  +-- 第二条消息提交时 sessionId/ccflowSessionId 选择

tests/server/
tests/spec/
  +-- 同一 cN 连续发送两条消息的端到端业务覆盖
```

## 非目标

- 不恢复 Claude SDK 支持。
- 不绕过 co 文件协议直接调用 Codex/OpenCode。
- 不用解析 provider 原始 JSONL 替代 co 标准事件。
- 不重做聊天 UI 布局。
- 不启动 sealed wo run，不创建 wo 运行态文件。

## 测试意图

- Server 测试：构造 co conversation 第 1 个 turn 已完成，第 2 个 request 写入后产生新 `active_turn_id`，ccflow 必须 attach tail 并广播第 2 个 turn 的 `codex-response`。
- Server 测试：同一 `cN` 第二个 turn 的事件必须带 `ccflowSessionId/ccflow_session_id`，前端路由可识别。
- 前端业务测试：同一页面发送“第一条”和“第二条”，断言两个 user 消息均为 sent，两个 assistant 响应均显示一次。
- 前端业务测试：在 REST 历史已加载第一轮的情况下，第二轮实时响应不得被去重逻辑误判为旧消息。
- 回归测试：idle `check-session-status` 仍不得重放旧历史响应。

## 开放问题

- 需要执行阶段先确认 co 的第 2 个 turn 是否真的写出了标准 `codex-response`/`opencode-response`。如果没有，执行 `../co/docs/changes/3-保障续发turn事件回流`；如果有，则修复 ccflow 的观察、广播或前端过滤逻辑。

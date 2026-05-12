## 总体设计

本变更按“先定位 ccflow 回流链路，再决定是否下沉到 co”的顺序执行。ccflow 的职责是把用户消息写成 co request，并把 co 写出的 turn events 实时转发到当前浏览器视图。

```text
第 2 条消息正确链路

Browser
  |
  | codex-command / opencode-command
  | sessionId: null for cN
  | ccflowSessionId: c51
  v
ccflow
  |
  | writeCoRequest(conversation_id=c51)
  | observeCoConversationTurns(c51)
  v
co
  |
  | conversations/c51/state.json -> active_turn_id=t2
  | turns/t2/events.jsonl -> codex-response
  v
ccflow tail
  |
  | broadcast { type: codex-response, ccflowSessionId: c51, turnId: t2 }
  v
Browser current c51 view
  |
  `-- append assistant message once
```

## 关键决策

### 以 cN route id 作为网页续聊主身份

前端在 `cN` 会话里续聊时，不应把 provider session id 当成 conversation id。执行阶段需要确认：

- composer 发送第 2 条消息时 `ccflowSessionId` 是 `cN`；
- `sessionId` 不把 `cN` 当 provider resume id；
- 后端 `buildCoRequest.conversation_id` 使用同一个 `cN`；
- provider session 恢复由 co 的 conversation state 决定。

### co turn 观察必须覆盖“当前无 active turn -> 新 turn 出现”

第 1 轮完成后，conversation 可能进入 idle，`active_turn_id` 为空。第 2 条消息写入后，ccflow 必须持续观察同一 conversation，直到新 turn 出现并开始 tail。

执行阶段重点检查：

- `observeCoConversationTurns` 复用旧 observer 时是否重置 idle 计时；
- `seenTurnIds` 是否错误屏蔽新 turn；
- `excludeTurnId` 是否只排除上一轮，而不是排除当前新 turn；
- `recoverCoConversation` 是否在新 turn 出现时 attach tail；
- terminal payload 是否过早关闭 tail，导致最后一个 assistant event 未广播。

### 前端去重只按稳定事件身份去重

第 2 个 turn 的响应必须和第 1 个 turn 有不同 messageKey：

```text
co:<conversationId>:<turnId>:event:<seq>
```

执行阶段需要确认 `turnId` 和 `seq` 都来自最新事件。不能只按文本内容、provider session id 或 route id 去重，否则连续相似回复会被误丢。

### status 轮询不能把 running turn 误清空

`check-session-status` 用于恢复 missed complete events，但如果它在 co state 短暂 idle 时把当前页面 loading 清掉，不应影响后续 response append。执行阶段需要确认 session-status 只影响状态，不丢弃后续 `codex-response`/`opencode-response`。

## 与 co 的边界

如果 ccflow 能看到 `turns/t2/events.jsonl` 中有标准响应事件但前端没有显示，根因在 ccflow。

如果 co 没有生成第 2 个 turn 的响应事件，或 queued turn 只进入 state 但没有运行 provider，则根因在 `../co`，执行配套提案：

```text
../co/docs/changes/3-保障续发turn事件回流
```

## 风险与处理

- **再次引入旧历史重复回放**：保留 idle status 不回放历史的测试。
- **多窗口互相污染**：广播仍按用户隔离，并带 `ccflowSessionId` 让前端过滤。
- **排队消息跨 turn 丢失**：测试要覆盖第 2 条在第一条完成后发送，以及第一条 running 时第 2 条 queued 两种场景。
- **provider 差异**：Codex 和 OpenCode 都走 co 标准事件，至少 server 层要用 provider 参数覆盖两类事件名称。

## 测试策略

执行阶段应新增或更新真实测试代码：

- `tests/server/co-followup-realtime.test.js`：用临时 `CCFLOW_CO_HOME` 和真实 WebSocket，模拟第 1 turn 历史、第 2 turn 事件文件追加，断言前端可收到第 2 turn `codex-response`。
- 更新 `tests/spec/2026-05-10-11-修复co续聊历史重复回放-chat-realtime-dedup.spec.js` 或新增 Playwright：同一 `cN` 页面连续发送两条消息，两个 assistant 响应都显示且不重复。
- 更新 `tests/spec/integrate-opencode-provider.spec.js` 的源码契约测试，覆盖 observer 复用时不会丢新 active turn。
- 保留 `idle check-session-status sends only session-status` 回归测试。

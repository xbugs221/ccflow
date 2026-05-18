# 设计：修复 OpenCode 用户消息气泡和续发回显

## 现状

OpenCode 手动会话已经通过 co 执行，co durable state 保存了 request、turn state、events 和 conversation state。cbw 的 `readCoConversationMessages` 负责把这些文件还原成聊天 transcript。

当前实现有两个缺口：

1. `readCoConversationRequests` 只扫描 `done/running/pending`，没有扫描 `claimed`。请求刚被 daemon 认领时，页面刷新或 session load 可能读不到 user 文本。
2. turn 与 request 的关联只依赖 `turns/<turn>/request.json` 或 turn id 后缀匹配 request id。实际 OpenCode turn 目录可能没有 `request.json`，但 `turns/<turn>/state.json` 和 `result.json` 保存了正确 `request_id`。

结果是 assistant events 能被读出，但 user request 无法配对，于是 UI 只显示 assistant 气泡。

## 数据流

```text
co requests
  pending/        request.text
  claimed/        request.text  <- active turn window
  running/        request.text
  done/           request.text

co turns/<turn_id>
  request.json?   optional
  state.json      request_id, provider, conversation_id
  result.json     request_id, provider, conversation_id
  events.jsonl    opencode-response / opencode-complete

cbw read model
  conversation state -> turn ids
  turn state/result  -> request_id
  request_id         -> request.text
  transcript         -> user + assistant messages
```

## 技术方案

### 扫描 request 桶

`readCoConversationRequests(conversationId)` 应扫描：

```text
pending
claimed
running
done
```

返回的 request 仍按 `created_at` 排序。同一个 request id 如果出现在多个桶，应只保留最新可读版本，避免重复 user 消息。

### 建立 turn 到 request 的映射

新增小函数读取 turn metadata：

```text
turn request_id 来源优先级
1. turns/<turn_id>/request.json
2. turns/<turn_id>/state.json
3. turns/<turn_id>/result.json
4. 历史兼容：turn id 后缀匹配 request id
```

只有 `conversation_id` 匹配当前会话时才使用该 metadata，避免跨会话串线。

### 生成 user 消息

对每个排序后的 turn：

```text
request_id -> request.text
  -> type=user
  -> message.role=user
  -> message.content=request.text
  -> messageKey=co:<conversationId>:<turnId>:user:<requestId>
```

这样 user 消息 key 与 request id 绑定，能和前端 optimistic bubble 去重。

### 第二条消息发送后不消失

发送第二条 OpenCode 消息时，前端已有 optimistic user bubble；随后 session status / message load 可能触发一次 co read model 刷新。刷新结果必须包含 claimed/running request 的 user 消息，或至少不得把仍未 durable-confirm 的 optimistic bubble 清掉。

优先修复后端 durable transcript：只要 request 进入 pending/claimed/running/done 任一桶，就能回读成 user 消息。前端只保留必要的去重和失败标记逻辑，不把 realtime event 当最终事实源。

## 风险

- request 文件在桶迁移时短暂不可见。
  - 处理：保留 optimistic bubble，下一次轮询/状态收敛再用 durable request 替换。
- 历史 turn 缺少 request metadata。
  - 处理：不做时间模糊匹配，只显示已有 assistant，避免误配其他 request。
- Codex/Pi 也使用 co read model。
  - 处理：测试覆盖 provider=opencode 的目标行为，同时保留 Pi co read model 已有场景。

## 测试

执行阶段应新增这些真实测试：

- `tests/server/...co-opencode-message-loading.test.ts`：直接调用 `handleGetSessionMessages` 或 `readCoConversationMessages`，构造两个 OpenCode turn，只通过 `state.json.request_id` 配对 request，断言 transcript 包含两条 user 和两条 assistant。
- `tests/server/...co-opencode-claimed-request.test.ts`：request 位于 `claimed`，turn state 为 running，断言 user 消息可见。
- `tests/spec/...opencode-followup-user-bubble.spec.ts`：浏览器发送第一条和第二条 OpenCode 消息，刷新后用户气泡仍存在。
- 更新去重相关测试：durable user message 到达后，不重复显示 optimistic bubble。

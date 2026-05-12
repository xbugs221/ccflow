## 1. 复现与定位

- [x] 1.1 构造同一 `cN` 页面连续发送两条消息的最小复现。
- [x] 1.2 记录第 2 条消息对应的 co request、conversation state、turn state 和 events.jsonl。
- [x] 1.3 判断第 2 个 turn 的标准 response event 是否已由 co 写出。
- [x] 1.4 若 co 未写出第 2 个 turn response，切换执行 `../co/docs/changes/3-保障续发turn事件回流`。

## 2. 修复 ccflow co 回流链路

- [x] 2.1 检查 composer 第 2 条消息发送时 `ccflowSessionId` 和 `sessionId` 的选择。
- [x] 2.2 确认后端 `buildCoRequest.conversation_id` 使用当前 `cN`。
- [x] 2.3 修复 `observeCoConversationTurns` 在 observer 复用、idle 后新 turn、queued turn 启动时的漏 tail 问题。
- [x] 2.4 确保 broadcast 的 co event 始终带 `ccflowSessionId`、`ccflow_session_id`、`turnId`。
- [x] 2.5 修复前端 `codex-response` / `opencode-response` session 过滤或去重误丢第 2 轮响应的问题。
- [x] 2.6 保留 idle status 不 replay 历史响应的行为。

## 3. 真实测试代码

- [x] 3.1 在本提案 `tests/` 目录编写 server 复现测试，执行阶段同步到根测试套件。
- [x] 3.2 新增 server WebSocket 测试：第 2 个 co turn response 必须广播到同一 `cN`。
- [x] 3.3 新增或更新 Playwright 测试：同一会话连续发送两条消息，两个 assistant 响应都显示一次。
- [x] 3.4 新增 queued 场景测试：第 1 轮 running 时提交第 2 条，第 2 轮启动后响应可见。
- [x] 3.5 保留并运行 idle `check-session-status` 不重放历史响应测试。

## 4. 验证

- [x] 4.1 运行 `oz validate 19-修复co续发消息响应丢失 --json`。
- [x] 4.2 运行 co/聊天相关 server 测试。
- [x] 4.3 运行同一页面连续续聊 Playwright 测试。
- [x] 4.4 确认本变更不启动 sealed wo run、不创建 wo 运行态文件。

## 1. 复现和定位

- [x] 1.1 使用现有 `c51` 或 fixture co home 复现不刷新续聊时旧消息重复显示。
- [x] 1.2 记录前端加载顺序：REST session messages、`check-session-status`、WebSocket `codex-response`。
- [x] 1.3 确认 idle conversation 的重复来源是 `replayCoConversationEvents` 全量回放历史 turn events。
- [x] 1.4 确认运行中 active turn 仍需要哪些补发行为，避免修复时误伤断线恢复。

## 2. 修正后端 co 状态检查

- [x] 2.1 调整 `check-session-status`：idle conversation 只返回状态，不全量 replay 历史 turn events。
- [x] 2.2 保留 running conversation 的 active turn 恢复能力。
- [x] 2.3 确认 `session-status` 的 `sessionId`、`ccflowSessionId`、`turnId` 字段足够前端识别当前视图。
- [x] 2.4 如保留 replay helper，明确它只能用于 active turn 或显式 cursor 同步，不作为 idle 默认行为。

## 3. 增强前端实时消息幂等

- [x] 3.1 为 co/Codex 实时 agent message 选择稳定 identity，优先使用 session、turn、event、message key、client request 字段。
- [x] 3.2 在 `useChatRealtimeHandlers` 中避免把已存在于 `chatMessages` 或 `sessionMessages` 的消息重复 append。
- [x] 3.3 区分 `cN` route session 和 `new-session-*` 草稿，收敛临时会话判断函数。
- [x] 3.4 验证同文本不同 turn 的真实消息不会被误删。

## 4. 真实测试代码

- [x] 4.1 在本提案 `tests/` 目录编写 server 测试：idle `check-session-status` 不重放历史 agent_message。
- [x] 4.2 在本提案 `tests/` 目录编写前端业务测试：已加载历史后收到 replay 事件不重复显示。
- [x] 4.3 在本提案 `tests/` 目录编写 Playwright 测试：同一 `cN` 会话连续续聊不重复旧历史。
- [x] 4.4 执行阶段将真实测试同步到仓库根测试套件，命名包含本 change 编号和中文来源。

## 5. 验证

- [x] 5.1 运行 `oz validate 11-修复co续聊历史重复回放 --json`。
- [x] 5.2 运行新增 server 测试。
- [x] 5.3 运行新增前端业务测试或对应 browser/spec 测试。
- [x] 5.4 运行新增 Playwright e2e 测试。
- [x] 5.5 手动或自动确认没有创建 `.wo/runs/` 运行态文件。

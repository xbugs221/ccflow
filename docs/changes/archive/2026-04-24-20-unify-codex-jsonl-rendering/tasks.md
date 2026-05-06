## 1. 后端 JSONL 增量读取

- [x] 1.1 梳理 Codex session 定位逻辑，确认 `~/.codex/sessions/**/*.jsonl` 与项目路径、sessionId 的匹配规则。
- [x] 1.2 实现基于 JSONL 行号或 byte offset 的增量读取接口，返回新增原始行、解析消息、下一个游标和总游标。
- [x] 1.3 将 `session_meta`、`event_msg`、`response_item`、`turn_context` 等行统一纳入游标推进，过滤行不得影响下一次读取位置。
- [x] 1.4 对重复文件变化通知、空增量和 session 切换加入幂等保护。
- [x] 1.5 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/codex-jsonl-single-source-rendering.spec.js --grep "重复文件变化通知|非渲染 JSONL 行"` 全部通过。

## 2. Codex 消息归一化与工具卡片合并

- [x] 2.1 收敛 Codex JSONL normalizer，使历史全量加载和运行中增量加载使用同一输出结构。
- [x] 2.2 支持 `message`、`reasoning`、`function_call`、`function_call_output`、`custom_tool_call`、`custom_tool_call_output` 的稳定解析。
- [x] 2.3 按 `call_id` 合并 tool call 与 tool output；缺失 `call_id` 时用 JSONL 游标生成稳定 fallback key。
- [x] 2.4 保持工具卡片在 output 到达后原地更新，不新增重复卡片，不改变相对顺序。
- [x] 2.5 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/codex-jsonl-single-source-rendering.spec.js --grep "工具"` 全部通过。

## 3. 前端 Codex 消息状态单一来源

- [x] 3.1 改造 Codex 会话初始加载、刷新恢复和增量更新，使其只写入 JSONL 派生的 `sessionMessages`。
- [x] 3.2 让 `chatMessages` 对 Codex 会话只由 `sessionMessages -> convertedMessages` 派生，不再混入 realtime-only 消息。
- [x] 3.3 移除或隔离 WebSocket Codex 分支中直接 append/replace toolcall、assistant 正文和 tool result 的逻辑。
- [x] 3.4 保留 WebSocket 的 Thinking、Abort、completion 和 refresh notification 语义，但这些事件不得覆盖消息内容。
- [x] 3.5 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/codex-jsonl-single-source-rendering.spec.js --grep "运行中|刷新|session-status|完成"` 全部通过。

## 4. 顺序、刷新与总体验收

- [x] 4.1 用 generation/sessionId 防止旧 session 的异步增量结果写入当前会话。
- [x] 4.2 确保 reasoning、toolcall、tool output、assistant text 按 JSONL 逻辑顺序渲染。
- [x] 4.3 确保新增 JSONL 增量追加在已渲染前缀之后，不清空、不重排、不重复。
- [x] 4.4 执行类型检查和现有相关测试，确认改动没有破坏非 Codex provider。
- [x] 4.5 验收：`./openspec/changes/20-unify-codex-jsonl-rendering/test_cmd.sh` 全部通过。

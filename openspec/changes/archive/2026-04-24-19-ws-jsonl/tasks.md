## 1. Codex 消息归一化模型

- [x] 1.1 梳理 Codex JSONL `response_item` 中 message、function_call、function_call_output、file_change、mcp/ctx 工具输出到现有 `ChatMessage` 的映射缺口。
- [x] 1.2 新增或整理 Codex 标准消息归一化模块，使 JSONL 加载和 WS 实时事件能复用同一转换规则。
- [x] 1.3 将 commentary、thinking/final answer、普通 assistant 文本和错误状态统一映射到刷新前后一致的 UI 消息字段。
- [x] 1.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/codex-jsonl-message-rendering.spec.js -g "Codex 实时消息刷新后保持 JSONL 视觉结构"` 通过。

## 2. WebSocket 实时路径接入 JSONL 语义

- [x] 2.1 调整 Codex WS `codex-response` 处理，让 agent_message、reasoning、command_execution、file_change、mcp_tool_call 使用标准归一化结果更新聊天状态。
- [x] 2.2 确保 JSONL 中会持久化的 Edit file 指令在实时阶段立即可见，不依赖刷新后的历史回放补齐。
- [x] 2.3 在 Codex 完成事件后保留刷新前同一视觉结构，不用临时占位消息替代已标准化的工具卡片。
- [x] 2.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/codex-jsonl-message-rendering.spec.js -g "Codex JSONL 中的 Edit file 指令在实时阶段可见"` 通过。

## 3. 工具调用生命周期卡片

- [x] 3.1 为每个 Codex 工具调用建立稳定聚合 key，关联发起指令、实时输出、最终结果、错误和退出状态。
- [x] 3.2 实现运行中工具卡片展开展示，顶部固定显示工具名和发起指令，输出区域只保留最新五行。
- [x] 3.3 实现所有完成、失败或中断的工具卡片默认折叠，并保留可展开详情。
- [x] 3.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/codex-jsonl-message-rendering.spec.js -g "运行中的 Codex 工具卡片只显示最新五行输出"` 通过。
- [x] 3.5 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/codex-jsonl-message-rendering.spec.js -g "完成、失败或中断后的 Codex 工具卡片全部默认折叠"` 通过。

## 4. 结构化工具渲染一致性

- [x] 4.1 将 ctx 系列工具输出映射到现有结构化 ContentRenderer，避免实时阶段显示普通文本、刷新后才变结构化。
- [x] 4.2 将 Edit file / apply_patch / file_change 映射到文件变更类结构化渲染，标题、文件摘要、折叠状态和详情刷新前后一致。
- [x] 4.3 确认现有 Claude 结构化工具渲染测试不因 Codex 归一化改动回归。
- [x] 4.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/codex-jsonl-message-rendering.spec.js -g "ctx 工具刷新前后保持同一结构化渲染"` 通过。
- [x] 4.5 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/codex-jsonl-message-rendering.spec.js -g "Edit file 工具刷新前后保持同一结构化渲染"` 通过。

## 5. 总体验收

- [x] 5.1 运行 `openspec/changes/19-ws-jsonl/test_cmd.sh`，确认 19-ws-jsonl 的全部验收测试通过。

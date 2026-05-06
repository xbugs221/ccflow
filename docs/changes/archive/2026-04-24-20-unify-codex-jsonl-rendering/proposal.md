## Why

当前 Codex 聊天消息同时由 WebSocket 实时事件和 JSONL 历史回放两条路径写入前端消息列表，运行中容易出现 toolcall、正文或 Thinking 状态互相覆盖，导致用户看到的执行过程不稳定。用户明确接受前端相对 JSONL 有轻微延迟，优先要求消息按落盘事实可靠、去重、按顺序渲染。

## What Changes

- Codex 会话消息列表统一以 `~/.codex/sessions/**/*.jsonl` 解析结果为事实来源。
- WebSocket 不再直接创建或覆盖 Codex 聊天消息，只用于会话状态、可中断状态和“有新落盘内容”的通知。
- 后端提供基于 JSONL 行号或字节位置的稳定增量游标，避免用前端消息数量推断文件读取位置。
- 前端按后端返回的 JSONL 增量追加、去重、排序并渲染 `sessionMessages -> chatMessages`。
- toolcall 与 tool result 必须按 `call_id` 合并成稳定工具卡片，刷新、中途重连和重复通知不得造成重复或丢失。
- 暂不实现工具卡片内长周期命令的实时最新五行输出；完成输出仍从 JSONL 的最终 `function_call_output` 渲染。

## Capabilities

### New Capabilities

- `codex-jsonl-message-rendering`: Codex 会话消息从 JSONL 单一路径解析、增量同步、去重排序并稳定渲染。

### Modified Capabilities

无。

## Impact

- 影响后端 Codex JSONL 会话定位、解析、增量读取和 WebSocket 通知语义。
- 影响前端聊天状态管理、Codex realtime handler、消息转换、工具调用合并和刷新恢复逻辑。
- 影响验收测试覆盖：需要验证中途刷新、重复文件变化通知、toolcall/result 合并、消息顺序和最终落盘渲染一致性。

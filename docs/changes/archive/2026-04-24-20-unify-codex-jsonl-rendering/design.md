## Context

Codex 会话消息目前有两条前端写入路径：WebSocket 运行中事件会直接更新 `chatMessages`，JSONL 历史加载会更新 `sessionMessages` 并转换为 `chatMessages`。当 Codex 运行中持续落盘、前端刷新或收到重复更新通知时，两条路径会互相覆盖，表现为 toolcall 或正文短暂出现后又被 Thinking 状态替换，直到回合结束才一次性恢复完整消息。

本变更把 Codex 消息列表的事实来源收敛到 `~/.codex/sessions/**/*.jsonl`。WebSocket 仍保留连接状态、会话状态、可中断状态和“有新内容”的通知能力，但不再拥有消息列表。

## Goals / Non-Goals

**Goals:**

- Codex 消息从 JSONL 单一路径解析、增量同步、去重排序并渲染。
- 支持页面刷新、中途重连、重复文件变化通知和临时 session 切换后的稳定恢复。
- toolcall 与 tool result 使用 `call_id` 合并为一个稳定工具卡片。
- 后端用文件行号或字节位置维护增量游标，前端不再用消息数量推断 JSONL 读取位置。
- 验收测试覆盖真实业务风险：运行中刷新、重复通知、顺序稳定、工具调用合并和最终完成态。

**Non-Goals:**

- 不实现工具卡片内长周期命令 stdout 最新五行的实时刷新。
- 不改变 Claude 会话的消息加载语义。
- 不引入新的外部依赖或数据库。
- 不要求字符级流式输出；允许前端相对 JSONL 落盘有轻微延迟。

## Decisions

### 1. JSONL 是 Codex 消息列表唯一事实来源

运行中和刷新后的 Codex 消息都必须从同一套 JSONL 解析器产出。这样可以消除 WebSocket 实时态与 JSONL 回放态之间的竞态。

备选方案是继续修补 `codex-realtime` 与 `convertedMessages` 的合并规则。这个方案短期改动小，但仍保留两个状态源，后续每个事件类型都可能出现新的覆盖或重复问题。

### 2. 后端维护文件级增量游标

Codex JSONL 是 append-only 文件，应以行号或 byte offset 作为游标读取新增内容。接口返回值应包含新增消息、下一个游标和当前总游标，前端将游标作为下一次增量请求的输入。

备选方案是沿用前端已知消息数量作为 `afterLine`。这个方案会把“UI 消息数量”和“JSONL 文件行数”混在一起，遇到 reasoning、toolcall 合并或过滤行时会漏读或重复读。

### 3. 前端只保存 JSONL 派生消息状态

Codex 会话的 `chatMessages` 应由 `sessionMessages -> convertedMessages` 派生。WebSocket handler 不再直接 append Codex toolcall、assistant 正文或 tool result，只能触发增量拉取或设置会话状态。

备选方案是让 WebSocket 写临时消息、JSONL 最终替换。这会保留用户已观察到的“运行中被覆盖”风险。

### 4. 工具调用按 `call_id` 合并

JSONL 中 `function_call`、`function_call_output`、`custom_tool_call`、`custom_tool_call_output` 必须按 `call_id` 合并为同一工具卡片。缺失 output 时卡片显示 running/pending 状态；output 到达后转为 completed/failed 并保持原位置。

备选方案是把 call 和 output 渲染为两条消息。这个方案排序简单，但不符合现有工具卡片体验，也会让刷新前后结构不一致。

### 5. WebSocket 只做通知与状态

`session-status` 仍用于 Thinking、Abort、完成/失败等状态。文件变化或 Codex 事件只通知前端“该 session 有新增 JSONL 内容”，由前端再拉取增量。重复通知必须幂等。

备选方案是后端直接通过 WebSocket 推解析后的增量。该方案也可行，但需要更强的 socket 顺序与重放保障；当前优先选择前端按游标主动拉取，便于刷新恢复。

## Risks / Trade-offs

- [Risk] JSONL 中某些运行中细节不会实时落盘。→ Mitigation：本变更明确接受轻微延迟，不实现 live stdout tail；最终落盘结果必须完整展示。
- [Risk] 文件变化通知可能重复、乱序或丢失。→ Mitigation：以后端游标和前端会话 generation 做幂等保护，重复拉取不得重复渲染。
- [Risk] `call_id` 缺失或重复会影响工具卡片合并。→ Mitigation：优先使用 `call_id`，缺失时用 JSONL 行号与 payload 类型生成稳定 fallback key。
- [Risk] 旧的 realtime handler 仍可能写入 Codex 消息。→ Mitigation：实现时移除或隔离 Codex 消息写入分支，仅保留状态分支，并用验收测试覆盖运行中刷新。

## Migration Plan

1. 在后端新增或改造 Codex JSONL 增量读取接口，返回基于文件游标的新增解析消息。
2. 复用并收敛 Codex JSONL normalizer，使历史加载和增量加载使用同一输出结构。
3. 改造前端 Codex 会话状态：初始加载和增量更新都写入 `sessionMessages`，`chatMessages` 只做派生渲染。
4. 移除 Codex realtime handler 中直接写消息列表的逻辑，保留状态更新和增量触发。
5. 运行 `tests/spec/codex-jsonl-message-rendering.spec.js` 验收。

回滚策略：保留现有 JSONL 全量加载接口和 provider 判断；若新增量路径异常，可临时恢复到完成后全量 reload，但不得恢复 WebSocket 与 JSONL 双写消息列表。

## Open Questions

无。用户已确认暂不考虑工具卡片最新五行实时输出，优先保证 JSONL 单一路径的稳定可靠。

## Why

现有聊天会话链路把手动会话路由编号、provider 真实 session id、前端 pending 状态和历史 jsonl 读取耦合在一起；当用户快速创建多个新会话、刷新页面或切换会话时，真实 session id 回填可能依赖前端单例状态而出现错绑风险。

本变更需要把 `c1` 这类 ccflow 路由会话与 Claude/Codex 原生 session 明确解耦，用 ccflow 自有会话索引记录启动、绑定、实时事件、steer 干预和历史校准，保证不改写 provider 原生 jsonl 的前提下提供稳定的一致性。

## What Changes

- 新增 ccflow 会话索引文件，作为 `c1/c2` 路由会话、启动请求、provider 真实 session id、消息事件和历史校准游标的权威记录。
- 保留现有 `c1` 形式的简化会话路由编号，但不再把它视为 Claude/Codex 的真实 session id。
- 首条消息启动前先持久化 pending 会话和启动请求，provider 返回真实 session id 后由后端按 `ccflow_session_id + start_request_id` 原子绑定。
- WebSocket 事件统一携带 `ccflow_session_id`、`event_seq`、`message_id`、`revision` 和必要的 provider session 信息，前端按事件序号和消息版本幂等合并。
- 支持运行中 steer：用户消息在 Claude Code/Codex CLI 原生支持的工具调用后安全边界注入，并在 ccflow 索引中记录 accepted、queued、injected、failed 等状态。
- 历史校准采用 provider jsonl 只读 + ccflow 索引 overlay 的方式，使用 at-least-once 事件投递和幂等合并，不改写 Claude/Codex 原生 jsonl。
- 移除首条消息真实 session id 回填对前端 `sessionStorage` 单例 pending 状态的依赖。

## Capabilities

### New Capabilities

- `session-management-refactor`: 定义 ccflow 路由会话与 provider 原生 session 的绑定、事件索引、断线恢复、steer 干预和历史校准行为。

### Modified Capabilities

- 无。

## Impact

- 后端会话管理：`server/projects.js`、`server/index.js`、`server/openai-codex.js`、`server/claude-sdk.js` 需要传递并持久化 ccflow 会话上下文。
- 前端聊天状态：`src/components/chat/hooks/useChatComposerState.ts`、`src/components/chat/hooks/useChatRealtimeHandlers.ts`、`src/hooks/useProjectsState.ts` 需要改为按 `ccflow_session_id` 和 `event_seq` 处理 pending、实时事件和历史校准。
- 项目配置和文件存储：新增 ccflow 会话索引文件，不改写 Claude/Codex 原生 jsonl。
- 测试：新增 acceptance tests 覆盖多新会话并发启动、刷新恢复、steer 注入和历史校准幂等性。

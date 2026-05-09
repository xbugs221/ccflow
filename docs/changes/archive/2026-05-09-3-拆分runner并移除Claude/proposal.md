## 背景

ccflow 当前由 Web 服务进程直接发起 Codex/OpenCode 手动会话。前端通过 WebSocket 发送 `codex-command` 或 `opencode-command`，后端在同一个 Node 进程里 `spawn` 对应 CLI，并用内存 `activeCodexSessions` / `activeOpencodeSessions` 跟踪运行状态。

这会导致服务重启时中断运行中的会话：

- CLI stdout/stderr 管道绑定在旧 Web 服务进程上。
- 运行状态只保存在内存里，重启后无法恢复。
- WebSocket writer 只能向当前进程内连接广播事件。
- Shell/PTY 路径还会在 shutdown 中显式清理子进程。

同时项目仍保留 Claude provider、Claude SDK、Claude 会话发现、设置、测试和文案。后续架构只需要支持 Codex 和 OpenCode 两个 CLI 工具，继续保留 Claude 会扩大改造面和状态组合。

## 变更内容

- 移除 Claude provider 支持，包括后端 SDK 适配、WebSocket 分支、REST 路由、前端 provider 入口、设置项、i18n 文案、测试夹具和相关文档。
- 将 provider 类型收敛为 `codex | opencode`，禁止继续使用 `claude` 默认回退。
- 新增独立 `ccflow-runner` 进程承载 Codex/OpenCode turn 执行，Web 服务不再直接 `spawn` 会话 CLI。
- 使用最小持久化运行态：
  - `.ccflow/runtime/turns/<turnId>/turn.json`
  - `.ccflow/runtime/turns/<turnId>/events.jsonl`
- Web 服务重启后扫描 `status=running` 的 turn，重新 tail `events.jsonl` 并恢复运行中状态。
- runner 事件沿用现有前端可消费的 `session-created`、`codex-response`、`opencode-response`、`codex-complete`、`opencode-complete`、错误事件等，不新增非必要协议字段。

## 能力范围

- 支持 Codex 手动会话在 Web 服务重启后继续运行，并在前端重连后继续显示事件流。
- 支持 OpenCode 手动会话在 Web 服务重启后继续运行，并在前端重连后继续显示事件流。
- 支持对运行中 turn 执行 abort，由 Web 服务请求 runner 终止对应 CLI 进程。
- 支持新会话草稿 `cN` 在 provider 产生真实 session id 后 finalize。
- 支持已有 Codex/OpenCode 会话继续 resume。

## 非目标

- 不新增通用任务队列、数据库迁移或外部消息中间件。
- 不把 prompt、summary、favorite、hidden、routeIndex 等 UI 元数据复制进 runner 运行态。
- 不重做 Codex/OpenCode 历史解析；历史消息仍以现有 provider session 文件为事实来源。
- 不支持 Claude，也不保留隐藏的 Claude fallback。
- 不要求 plain shell 终端跨 Web 服务重启存活；本提案聚焦 Codex/OpenCode 手动会话 turn。

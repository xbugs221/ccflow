## 新增需求

### 需求：手动会话只支持 Codex 和 OpenCode

系统必须移除 Claude provider，并只允许 Codex 和 OpenCode 作为手动会话 provider。

#### 场景：创建手动会话只接受 codex/opencode

- **当** 客户端请求 `POST /api/projects/:projectName/manual-sessions`
- **且** `provider` 为 `codex`
- **则** 后端必须创建 Codex 草稿会话
- **当** `provider` 为 `opencode`
- **则** 后端必须创建 OpenCode 草稿会话
- **当** `provider` 为 `claude` 或缺失且无法确定
- **则** 后端不得静默回退到 Claude

#### 场景：前端不再展示 Claude 入口

- **当** 用户打开聊天 provider 选择入口
- **则** 只能看到 Codex 和 OpenCode
- **且** 不得出现 Claude、Claude 模型选择、thinking mode 或 Claude 权限设置入口

#### 场景：WebSocket 不再处理 claude-command

- **当** 客户端发送 `claude-command`
- **则** 后端必须返回不支持的 provider 错误
- **且** 不得调用任何 Claude SDK 或 Claude CLI 逻辑

### 需求：Web 服务不得直接持有 Codex/OpenCode CLI 进程

系统必须通过独立 runner 执行 Codex/OpenCode turn，Web 服务不再直接 `spawn` 会话 CLI。

#### 场景：Codex turn 由 runner 执行

- **当** 用户向 Codex 手动会话发送消息
- **则** Web 服务必须创建最小 StartTurn 请求
- **且** runner 必须启动 Codex CLI
- **且** Web 服务不得把 Codex CLI stdout/stderr 作为自身子进程管道持有

#### 场景：OpenCode turn 由 runner 执行

- **当** 用户向 OpenCode 手动会话发送消息
- **则** Web 服务必须创建最小 StartTurn 请求
- **且** runner 必须启动 OpenCode CLI
- **且** Web 服务不得把 OpenCode CLI stdout/stderr 作为自身子进程管道持有

### 需求：运行态只写最小 turn 文件

系统必须只持久化恢复运行和终止 CLI 所需的 turn 状态。

#### 场景：运行中 turn 只生成两个运行态文件

- **当** runner 开始执行一个 turn
- **则** 必须创建 `.ccflow/runtime/turns/<turnId>/turn.json`
- **且** 必须创建 `.ccflow/runtime/turns/<turnId>/events.jsonl`
- **且** 不得为同一个 turn 额外创建 job、status、control、summary 或 UI 元数据文件

#### 场景：turn.json 字段保持最小

- **当** 系统写入 `turn.json`
- **则** 字段必须限定为恢复和终止所需信息
- **且** 不得包含 `summary`、`label`、`favorite`、`hidden`、`routeIndex`、完整 prompt、attachments 内容或 token 聚合缓存

#### 场景：events.jsonl 沿用现有前端事件

- **当** runner 收到 provider CLI 输出
- **则** 必须向 `events.jsonl` 写入当前前端可消费的事件类型
- **且** 不得创建一套新的复杂 UI 协议

### 需求：Web 服务重启不得打断运行中的 Codex/OpenCode turn

系统必须允许 Web 服务重启，而运行中的 Codex/OpenCode CLI turn 继续执行。

#### 场景：Codex turn 在 Web 服务重启后继续执行

- **当** Codex turn 正在运行
- **且** Web 服务进程重启
- **则** Codex CLI 进程必须继续运行
- **且** runner 必须继续向 `events.jsonl` 追加事件
- **且** Web 服务启动后必须恢复 tail 该 turn 的 `events.jsonl`
- **且** 浏览器重连后必须继续收到后续 Codex 事件

#### 场景：OpenCode turn 在 Web 服务重启后继续执行

- **当** OpenCode turn 正在运行
- **且** Web 服务进程重启
- **则** OpenCode CLI 进程必须继续运行
- **且** runner 必须继续向 `events.jsonl` 追加事件
- **且** Web 服务启动后必须恢复 tail 该 turn 的 `events.jsonl`
- **且** 浏览器重连后必须继续收到后续 OpenCode 事件

#### 场景：运行态 pid 不存在时标记 stale

- **当** Web 服务启动扫描到 `status = "running"` 的 `turn.json`
- **且** 其中 `pid` 已不存在
- **则** Web 服务必须把该 turn 标记为 failed 或 stale
- **且** 不得向前端持续展示该 turn 仍在处理中

### 需求：abort 通过 runner 终止 provider CLI

系统必须让 abort 请求作用到 runner 持有的 CLI 进程，而不是依赖 Web 服务内存 AbortController。

#### 场景：终止运行中的 Codex turn

- **当** 用户对运行中的 Codex turn 执行 abort
- **则** Web 服务必须请求 runner 终止对应 Codex CLI 进程
- **且** runner 必须更新 `turn.json` 状态为 aborted
- **且** runner 必须写入 `session-aborted` 或等价结束事件

#### 场景：终止运行中的 OpenCode turn

- **当** 用户对运行中的 OpenCode turn 执行 abort
- **则** Web 服务必须请求 runner 终止对应 OpenCode CLI 进程
- **且** runner 必须更新 `turn.json` 状态为 aborted
- **且** runner 必须写入 `session-aborted` 或等价结束事件

### 需求：测试覆盖真实业务行为

系统必须用 server 和浏览器测试覆盖 provider 收敛、runner 恢复和重启不中断行为。

#### 场景：server 测试覆盖最小运行态

- **当** 测试启动一个 Codex 或 OpenCode fake runner turn
- **则** 运行态目录必须只包含 `turn.json` 和 `events.jsonl`
- **且** `turn.json` 不得包含非必要 UI 字段

#### 场景：server 测试覆盖 Web 服务重启恢复

- **当** 测试构造一个 `status = "running"` 且 pid 存活的 turn
- **则** Web 服务恢复逻辑必须重新 tail `events.jsonl`
- **且** active sessions 查询必须返回该运行中会话

#### 场景：浏览器测试覆盖重连后继续收事件

- **当** 浏览器发送 Codex 或 OpenCode 消息
- **且** WebSocket 断开后重新连接
- **则** 页面必须继续展示 runner 后续写入的 provider 事件

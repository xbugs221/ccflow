## 设计原则

本次改造只拆出运行中 turn 的生命周期，不重建项目、会话、历史和 UI 状态系统。Web 服务负责用户交互和 read model，runner 负责 CLI 执行和事件落盘。

```
Browser
  |
  v
ccflow Web API
  - auth / project / session read model
  - manual session draft / finalize
  - websocket broadcast
  - tail events.jsonl
  |
  v
ccflow-runner
  - spawn codex/opencode
  - write turn.json
  - append events.jsonl
  - terminate CLI on abort
  |
  v
Codex CLI / OpenCode CLI
```

## 当前手动会话链路

```
前端新建会话
  |
  +-- POST /api/projects/:projectName/manual-sessions
  |     -> createManualSessionDraft()
  |     -> 返回 cN 草稿会话
  |
  v
前端发送消息
  |
  +-- provider=codex    -> WebSocket codex-command
  +-- provider=opencode -> WebSocket opencode-command
        |
        v
server/index.js handleChatConnection()
  |
  +-- startManualSessionDraft(cN)
  +-- message-accepted
  |
  +-- queryCodex()
  |     -> activeCodexSessions 内存登记
  |     -> spawn codex exec --json
  |     -> stdout 解析事件
  |     -> session-created 后 finalize cN
  |
  +-- queryOpencode()
        -> activeOpencodeSessions 内存登记
        -> spawn opencode CLI
        -> stdout 解析事件
        -> session-created 后 finalize cN
```

问题在于 Web 服务既是 HTTP/WebSocket 服务，也是 provider CLI 的父进程和事件管道持有者。重启 Web 服务会同时丢失进程关系、内存状态和广播能力。

## 新手动会话链路

```
前端新建会话
  |
  +-- POST /api/projects/:projectName/manual-sessions
        -> provider 只允许 codex/opencode
        -> createManualSessionDraft()
        -> 返回 cN 草稿会话

前端发送消息
  |
  +-- StartTurn(provider, projectPath, prompt, cN/providerSessionId)
        |
        v
ccflow Web API
  |
  +-- startManualSessionDraft(cN)
  +-- 创建最小 turn 请求
  +-- 交给 ccflow-runner
  +-- tail .ccflow/runtime/turns/<turnId>/events.jsonl
        |
        v
ccflow-runner
  |
  +-- 写 turn.json
  +-- spawn codex/opencode
  +-- CLI 事件追加到 events.jsonl
  +-- session-created 事件包含 providerSessionId
        |
        v
ccflow Web API
  |
  +-- 转发事件给浏览器
  +-- 看到 session-created 后 finalize cN
```

Web 服务重启后只需要重新扫描运行中的 turn 并恢复 tail，不需要重新启动 CLI。

## 最小运行态

每个运行中的 turn 只允许写两个文件：

```
.ccflow/runtime/turns/<turnId>/
  turn.json
  events.jsonl
```

`turn.json` 只保存恢复和终止所需字段：

```
{
  "turnId": "t_...",
  "provider": "codex",
  "status": "running",
  "projectPath": "/repo",
  "ccflowSessionId": "c3",
  "providerSessionId": null,
  "clientRequestId": "req_...",
  "pid": 12345,
  "startedAt": "2026-05-09T00:00:00.000Z"
}
```

不得写入这些非必要字段：

- `projectName`
- `summary`
- `label`
- `favorite`
- `hidden`
- `routeIndex`
- provider 展示名
- prompt 完整副本
- attachments 文件内容
- token 聚合缓存

这些数据要么已有存储来源，要么能从 provider 历史或事件中推导。

## StartTurn 输入

Web 服务传给 runner 的请求保持最小：

```
provider
projectPath
prompt
ccflowSessionId
providerSessionId
clientRequestId
model?
reasoningEffort?
permissionMode?
attachments?
```

`model` 和 `reasoningEffort` 只对 Codex 有意义。attachments 只传已上传文件的路径引用，不复制文件内容。

## 事件契约

runner 写入 `events.jsonl` 的事件应沿用当前前端可以处理的消息类型：

```
session-created
codex-response
opencode-response
token-budget
codex-complete
opencode-complete
codex-error
opencode-error
session-aborted
```

事件中只补充前端路由和关联需要的 `turnId`、`sessionId`、`ccflowSessionId`、`clientRequestId`。不得为 UI 展示重复写入 summary、favorite、hidden 等字段。

## 重启恢复

```
ccflow Web API start
  |
  +-- scan .ccflow/runtime/turns/*/turn.json
  |
  +-- status=running && pid alive
  |     -> 恢复 session processing 状态
  |     -> tail events.jsonl
  |
  +-- status=running && pid missing
        -> 标记 failed/stale
        -> 广播结束状态
```

runner 进程必须独立于 Web 服务生命周期。systemd 部署时应使用单独 service 或 scope，避免 Codex/OpenCode 子进程留在 Web service cgroup 中被重启连带终止。

## Claude 移除边界

移除 Claude 不做兼容层：

- 删除 Claude SDK 后端适配。
- 删除 `claude-command` WebSocket 分支。
- 删除 Claude provider 前端入口和默认 provider fallback。
- 删除 Claude 设置、模型、thinking mode、权限文案和测试。
- 项目 read model 不再把 Claude session 作为普通项目来源。
- 迁移 provider 类型、路由和测试到 `codex | opencode`。

旧 Claude 历史文件不再作为 ccflow 支持对象。本提案不提供 Claude 历史迁移。

## 风险

- runner 与 Web 服务事件 tail 之间可能重复广播事件，需要使用 `turnId` 加事件行号或事件 id 做幂等。
- systemd/cgroup 配置错误会导致 runner 或 CLI 仍被 Web 服务重启连带终止，需要在部署文档和验证中覆盖。
- 移除 Claude 会影响已有 Claude 用户入口，必须删除对应 UI 后避免出现不可点击的残留入口。

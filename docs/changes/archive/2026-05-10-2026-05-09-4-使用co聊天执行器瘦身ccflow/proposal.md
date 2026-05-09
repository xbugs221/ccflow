## 背景

ccflow 当前已经将 Codex/OpenCode turn 拆到 `ccflow-runner.js`，但该 runner 仍由 ccflow Web 服务启动和管理。在 systemd 使用 control-group 重启服务时，Web 服务进程及其派生子进程可能被一起终止，运行中的聊天会话仍会中断。

目标架构应把 ccflow 收敛为前端外壳和 read model 服务：工作流执行交给 `wo`，聊天执行交给新的独立 Go 二进制 `co`。ccflow 只写请求文件、读取状态文件、tail 事件 JSONL，并通过 WebSocket 推给浏览器。

## 变更内容

- 新增 `co` 聊天执行器协议，定义 `co-request-v1`、conversation state、turn state 和 `events.jsonl` 事件格式。
- 将 Codex/OpenCode 聊天执行生命周期从 ccflow Web 服务中移出，改为通过文件协议提交给 `co`。
- ccflow 不再直接 `spawn` Codex/OpenCode，不再维护 provider CLI 进程、AbortController、runner turn 目录或 provider stdout/stderr 管道。
- ccflow 启动时通过 `co doctor --json` 检查 co 二进制、协议版本和 provider 可用性。
- ccflow 发送消息时只向 `CCFLOW_CO_HOME/requests/pending/` 原子写入 request 文件。
- ccflow 读取 `co` 的 conversation/turn state，并 tail `events.jsonl` 向前端广播事件。
- 支持常见操作路径：
  - 同一会话续发消息。
  - 运行中发送第二条消息干预，通过 `active_policy` 表达 queue、reject、abort_and_send 或 steer。
  - 中断运行中的 turn。
  - 多浏览器窗口同时操作。
  - 刷新网页后恢复运行状态。
  - 更换设备后接力同一 `conversation_id`。
- 删除 `ccflow-runner.js` 和 Node 侧 runner-turns 执行管理代码，保留必要的 co 文件协议适配层。

## 能力范围

- co 作为独立守护进程运行，不属于 ccflow Web 服务进程树或 systemd cgroup。
- ccflow 重启只影响 WebSocket 连接，不终止 co 管理的聊天 turn。
- co 写出的事件继续兼容现有前端消息处理模型，减少 UI 改造面。
- 通过 `conversation_id` 把 ccflow 会话、provider session、active turn 和跨设备恢复串起来。

## 非目标

- 本提案不实现 co 的 Go 源码，只定义 ccflow 依赖的协议和调用方式，并改造 ccflow 消费该协议。
- 不改变 wo 工作流协议；wo 仍负责 `.wo/runs/<run-id>/state.json`。
- 不引入数据库、Redis 或消息队列。
- 不把 prompt 历史、summary、favorite、hidden、routeIndex 等 UI 元数据复制到 co。
- 不要求所有 provider 支持真正 live steer；不支持时 co 可写入 rejected 事件。

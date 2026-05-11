## 设计原则

ccflow 只做用户界面和 read model。执行状态由外部二进制拥有：

```text
Browser
  |
  v
ccflow Web
  - auth / project / session UI
  - write co request files
  - read co state
  - tail co events.jsonl
  - read wo state
  |
  +--> co daemon -> Codex/OpenCode CLI
  |
  +--> wo runner -> workflow state machine
```

## 二进制依赖

ccflow 启动时必须检查：

```bash
co doctor --json
wo --version 或 wo doctor --json
```

`co doctor --json` 至少返回：

```json
{
  "ok": true,
  "contract": "co-request-v1",
  "version": "0.1.0",
  "home": "/home/zzl/.local/state/ccflow/co",
  "providers": {
    "codex": { "available": true },
    "opencode": { "available": true }
  }
}
```

如果 co 不可用，ccflow 必须禁用聊天发送入口并展示可操作诊断，而不是退回 Node 内置执行。

## co home

ccflow 和 co 通过同一个运行目录通信：

```text
$CCFLOW_CO_HOME
  requests/
    pending/
    claimed/
    rejected/
  conversations/
    <conversation_id>/
      state.json
  turns/
    <turn_id>/
      request.json
      state.json
      events.jsonl
      control.json
      result.json
```

默认：

```text
~/.local/state/ccflow/co
```

## 请求写入

ccflow 发送消息或中断会话时只写 request 文件。写入必须原子化：

```text
requests/pending/<request_id>.json.tmp
requests/pending/<request_id>.json
```

`request_id` 由 ccflow 生成，并用于幂等。重复提交同一个 `request_id` 不得启动多个 turn。

## 请求字段

最小请求：

```json
{
  "contract": "co-request-v1",
  "request_id": "req_20260509_xxx",
  "op": "message",
  "created_at": "2026-05-09T12:00:00.000Z",
  "conversation_id": "c12",
  "project_path": "/home/zzl/projects/ccflow",
  "provider": "codex",
  "text": "用户输入内容",
  "active_policy": "queue",
  "target_turn_id": "",
  "provider_session_id_hint": "",
  "options": {
    "model": "",
    "reasoning_effort": "",
    "permission_mode": ""
  },
  "attachments": [],
  "actor": {
    "user_id": "local",
    "device_id": "device_xxx",
    "window_id": "window_xxx"
  }
}
```

`op` 只允许：

- `message`
- `abort`

`active_policy` 只允许：

- `queue`
- `reject`
- `abort_and_send`
- `steer`

## 会话身份

`conversation_id` 是 ccflow 会话的稳定身份，不是 provider session id。ccflow 在新会话草稿阶段即可生成 `conversation_id`，并在刷新网页、换设备和多窗口场景中复用它。

`provider_session_id_hint` 只是提示，用于导入旧会话或首次恢复，不作为可信路由依据。co 必须维护自己的 conversation state：

```json
{
  "contract": "co-conversation-v1",
  "conversation_id": "c12",
  "project_path": "/home/zzl/projects/ccflow",
  "provider": "codex",
  "provider_session_id": "019e0a...",
  "active_turn_id": "turn_20260509_xxx",
  "status": "running",
  "updated_at": "2026-05-09T12:02:00.000Z",
  "turns": ["turn_1", "turn_2", "turn_20260509_xxx"]
}
```

## 并发和 stale 操作

co 必须对同一个 `conversation_id` 串行处理请求。多窗口同时写入请求时，co 按 claim 顺序处理，但必须用 `target_turn_id` 防止 stale abort 或 stale steer 误伤新 turn。

规则：

- `op = abort` 且 `target_turn_id` 不等于当前 active turn 时，co 必须拒绝。
- `active_policy = abort_and_send` 且 `target_turn_id` 不等于当前 active turn 时，co 必须拒绝或按 `queue` 降级，不能中断新 turn。
- `active_policy = queue` 不要求 `target_turn_id`。

## 事件消费

ccflow 不解析 provider 原始输出，只消费 co 写入的标准事件：

```text
session-created
codex-response
opencode-response
token-budget
codex-complete
opencode-complete
codex-error
opencode-error
session-aborted
steer-rejected
message-rejected
```

每个事件必须包含：

- `type`
- `provider`
- `turn_id`
- `conversation_id`

有 provider session 时还必须包含：

- `session_id`

## ccflow 瘦身边界

删除或替换：

- `server/ccflow-runner.js`
- `server/runner-turns.js`
- WebSocket 内部直接调用 `queryCodex` / `queryOpencode` 的执行路径
- Node 侧 active provider session 进程表
- Node 侧 provider abort 进程管理

保留或改造：

- provider 历史读取和消息展示，直到 co 提供完整替代读模型。
- manual session draft/finalize，但 finalize 来源改为 co 的 `session-created` 事件。
- WebSocket 广播层。
- 上传附件保存逻辑，request 中只传附件路径引用。

## 风险

- co 未启动时，聊天发送入口必须明确不可用，避免用户以为消息已提交。
- 文件协议需要严格原子写入和幂等，否则多窗口会导致重复 turn。
- 不同 provider 对 steer 能力不同，UI 文案必须避免承诺“实时插话一定成功”。
- 从旧 `ccflow-runner.js` 迁移期间，要防止新旧执行路径同时存在导致重复发送。

## 执行记录

- 历史测试 `tests/2026-05-09-3-拆分runner并移除Claude-runner-turns.test.js` 绑定旧 Node runner 细节，已与本次“删除 Node runner、改用 co 文件协议”的新意图冲突；执行阶段用 co request/state/events 真实协议测试替换。
- `tests/spec/integrate-opencode-provider.spec.js` 中 WebSocket 断言原先要求直接导入 OpenCode SDK 和 abort 进程管理，已更新为断言 OpenCode 聊天经 `co-client` 写 request 并从 co conversation state 恢复。

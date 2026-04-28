## Context

ccflow 现有聊天链路已经支持手动会话草稿：用户新建会话时先创建 `c1/c2` 这类简化路由编号，首条消息真正发送后，Claude/Codex 生成原生 session id，再通过 finalize 流程把草稿路由替换为真实 provider session。当前实现用 `clientRequestId` 和前端 pending 状态降低误绑概率，但真实 session id 回填仍依赖当前页面、`sessionStorage` 单例键和 WebSocket 到达顺序。

新的会话管理需要保留 `c1` 路由语义，同时让 `c1` 成为 ccflow 自有会话身份，而不是 provider session id 的临时替身。Claude/Codex 原生 jsonl 仍然是 provider 事实来源，但 ccflow 需要自己的索引文件记录路由会话、启动请求、provider 绑定、实时事件、steer 干预和历史校准状态。

## Goals / Non-Goals

**Goals:**

- 保留 `/session/c1` 形式的简化路由，并保证它能稳定指向同一个 ccflow 会话。
- 在首条消息发送前持久化 pending 会话启动记录，刷新或切页后仍能恢复启动状态。
- 用 `ccflow_session_id + start_request_id` 绑定真实 provider session id，避免多个新会话并发时错绑。
- 新增 ccflow 会话索引文件，记录消息事件、事件序号、provider transcript offset 和 steer 状态。
- WebSocket 使用 at-least-once 投递，前端按 `event_seq`、`message_id`、`revision` 幂等合并。
- 支持 Claude Code/Codex CLI 原生 steer，在当前工具调用后插入用户消息。
- 不改写 Claude/Codex 原生 jsonl。

**Non-Goals:**

- 不改变 `c1/c2` 这类手动会话路由展示形式。
- 不要求 provider 原生 jsonl 使用 ccflow 统一消息 schema。
- 不实现 exactly-once WebSocket 投递。
- 不把 steer 扩展成任意时刻强制中断；steer 只在 provider 原生安全边界注入。

## Decisions

### 1. `c1` 是 ccflow 会话 ID，不是 provider session id

`c1/c2` 继续由后端草稿创建流程分配，并作为用户可见路由 ID。真实 provider session id 写入索引字段 `provider_session_id`。

备选方案是 provider 返回真实 session id 后替换 URL。该方案会破坏现有简化路由体验，也会让 pending 消息迁移依赖更多前端状态，因此不采用。

### 2. 新增 ccflow 会话索引文件

每个项目维护 ccflow 会话索引，建议按项目路径落盘到 ccflow 控制文件中，内容至少包含：

- `ccflow_session_id`: `c1/c2` 等路由会话 ID。
- `provider`: `claude` 或 `codex`。
- `provider_session_id`: provider 真实 session id，pending 启动时为空。
- `start_request_id`: 首条消息启动请求 ID。
- `status`: `draft`、`pending_start`、`running`、`completed`、`failed`、`aborted`。
- `events`: 按 `event_seq` 追加的 ccflow 事件。
- `messages`: 当前会话消息投影，可由事件重放生成。
- `provider_offsets`: provider jsonl 只读校准游标。
- `interventions`: steer 请求和注入状态。

备选方案是继续只用现有项目 config 和 provider jsonl。该方案无法表达 pending 启动、事件重放和 steer 状态，也无法消除前端 pending 单例竞态，因此不采用。

### 3. 后端负责真实 session id 绑定

首条消息发送时，前端必须提交 `ccflow_session_id` 和 `start_request_id`。后端启动 Claude/Codex 时把这两个 ID 放入 provider job context。provider 返回真实 session id 后，由后端执行原子绑定：

```text
bind where ccflow_session_id = c1
  and start_request_id = req-A
  and provider_session_id is empty
```

前端不再调用 finalize API 来猜测哪个 provider session 应绑定到哪个草稿。前端只接收 `session.bound` 事件并刷新视图。

备选方案是保留前端 `pendingSessionId` + finalize。该方案在多 draft、切页和刷新场景下仍可能串台，因此不采用。

### 4. WebSocket 事件使用 `event_seq` 重放

`message_id` 只表示一条 UI 消息身份，`event_seq` 才表示事件顺序和断线重放游标。每个会话事件必须带：

- `ccflow_session_id`
- `event_seq`
- `event_type`
- `message_id`，若事件作用于消息
- `revision`，若事件替换某条消息投影
- `provider_session_id`，若已绑定

断线后客户端提交最后处理的 `event_seq`。后端补发后续事件；若事件缓存不足，客户端重新读取会话索引和 provider 历史做全量校准。

### 5. 历史校准使用 overlay，不改原生 jsonl

Claude/Codex 原生 jsonl 保持只读。ccflow 索引保存 provider transcript 路径、行号、事件 ID 或 offset，用于把 provider 历史映射成统一消息投影。

校准顺序：

1. 读取 ccflow 索引事件。
2. 读取 provider jsonl 增量。
3. 将 provider 输出映射到 ccflow 消息投影。
4. 用 `message_id + revision` 幂等覆盖实时投影。

### 6. Steer 是 intervention，不创建新 turn

steer 是当前运行 turn 内的用户干预，必须有独立 `intervention_id` 和可见状态：

- `accepted`: 后端收到请求并写入索引。
- `queued`: provider 当前处于工具调用中，等待工具调用结束。
- `injected`: 已通过 Claude Code/Codex CLI 原生 steer 注入。
- `failed`: 会话已结束或 provider 拒绝注入。

steer 用户消息拥有自己的 `message_id`，但不创建新的普通 turn。后续 assistant 输出仍属于当前运行 turn。

## Risks / Trade-offs

- 多文件一致性风险 → 会话索引写入必须使用原子写或文件锁，避免并发事件损坏索引。
- WebSocket 重复事件 → 前端必须按 `event_seq` 和 `message_id + revision` 幂等处理。
- provider jsonl 延迟落盘 → 实时事件先来自 provider stream，历史校准稍后按 offset 修正。
- steer 注入边界依赖 provider 原生能力 → adapter 必须显式区分 queued、injected、failed，不能假装立即注入。
- 旧草稿迁移复杂 → 没有索引的旧 `c1` 草稿继续走兼容读取；首次发送后创建索引并绑定。

## Migration Plan

1. 新增会话索引读写模块，并支持从现有手动草稿生成初始索引记录。
2. 首条消息发送协议增加 `ccflow_session_id` 和 `start_request_id`。
3. Claude/Codex adapter job context 透传 ccflow 会话身份。
4. 后端绑定真实 provider session id 并广播 `session.bound`。
5. 前端移除对 `pendingSessionId` 单例 finalize 的依赖，改用 `ccflow_session_id` 过滤事件。
6. 接入 `event_seq` replay 和历史校准。
7. 接入 steer intervention 状态机。

回滚策略：保留旧 finalize API 一段时间，只用于没有索引记录的旧会话；新索引不可用时拒绝启动新会话并显示可重试错误，避免静默错绑。

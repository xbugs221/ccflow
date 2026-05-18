# 规格

### 需求：provider-aware wo sessions 必须生成 workflow child sessions

cbw 必须把 `wo state.sessions` 中的 provider role map 当作 workflow child session 来源，而不是只依赖 runner process rows。

#### 场景：Pi executor sessions-only 状态可进入子会话

- **给定** `wo state.json` 中存在 `sessions["pi:executor"] = "pi-thread-1"`
- **且** `state.processes` 不存在或为空
- **当** cbw 构造 workflow read model
- **则** `childSessions` 包含 id 为 `pi-thread-1` 的子会话
- **且** 该子会话的 provider 是 `pi`
- **并且** 该子会话的 stageKey 是 `execution`

#### 场景：sessions-only 状态不伪造进程

- **给定** `wo state.json` 只有 `sessions["pi:executor"]`
- **且** 没有真实 `processes`
- **当** cbw 构造 workflow read model
- **则** `runnerProcesses` 是空数组
- **但** workflow role summary 和 stage inspection 仍显示可进入的 Pi 会话

#### 场景：explicit process 与 role session 去重

- **给定** `state.processes[0].session_id = "pi-thread-1"`
- **且** `sessions["pi:executor"] = "pi-thread-1"`
- **当** cbw 构造 child sessions
- **则** `pi-thread-1` 只出现一次
- **且** process pid 保留在 `runnerProcesses`
- **并且** child session 的 provider 仍是 `pi`

#### 场景：非 Pi provider role map 同样可路由

- **给定** `sessions["opencode:executor"] = "opencode-thread-1"` 或 `sessions["codex:reviewer"] = "codex-thread-1"`
- **当** cbw 构造 workflow read model
- **则** 对应 child session 使用各自 provider
- **并且** 不得统一回退为 Codex

### 需求：Pi workflow child session 必须按 provider 加载消息

Pi workflow 子会话打开后，聊天页必须保留 workflow 和 provider 上下文，并从 co read model 读取消息。

#### 场景：点击 Pi role row 进入 workflow child route

- **当** 用户在 workflow 详情页点击 `pi:executor` 对应的“会话”
- **则** 浏览器进入 `/runs/<runId>/sessions/<address>` 或 `/runs/<runId>/sessions/by-id/<sessionId>`
- **且** selected session 的 `workflowId` 是当前 run
- **并且** selected session 的 `__provider` 是 `pi`

#### 场景：Pi child session 请求消息时携带 provider

- **给定** 当前 selected session provider 是 `pi`
- **当** 聊天页加载该 session 消息
- **则** 请求 `/api/projects/:projectName/sessions/:sessionId/messages` 时带有 `provider=pi`
- **且** 服务端不得尝试读取 Codex JSONL 作为 fallback

#### 场景：co conversation 存在时返回 Pi 消息

- **给定** co conversation state 中 `provider = "pi"`
- **且** `provider_session_id = "pi-thread-1"`
- **并且** turns/events 中存在用户消息和 assistant 文本事件
- **当** 前端加载 `pi-thread-1` 的消息
- **则** 页面展示 co durable history 中的用户消息和 assistant 消息
- **并且** 消息 provider 标记为 `pi`

#### 场景：co conversation 缺失时不跨 provider fallback

- **给定** wo state 记录了 `sessions["pi:executor"] = "pi-thread-missing"`
- **但** co 没有对应 conversation
- **当** 前端加载该 child session
- **则** 消息区可以为空或显示明确错误反馈
- **且** 不得显示同名 Codex/OpenCode 会话内容

### 需求：active oz changes API 必须走轻量路径

新建工作流弹窗读取 active oz changes 时，不得重建全项目 provider/session/sidebar read model。

#### 场景：打开弹窗不触发全量项目会话扫描

- **当** 前端打开工作流操作弹窗
- **则** `/api/projects/:projectName/openspec/changes` 只解析当前 project path
- **且** 不调用全量 provider session population
- **并且** 不需要 `attachWorkflowMetadata(await getProjects())`

#### 场景：返回未被 workflow claim 的 active changes

- **给定** `oz list --json` 返回 active changes `["a", "b"]`
- **且** 当前项目已有 workflow claim 了 `"a"`
- **当** 请求 active changes API
- **则** 返回 `["b"]`
- **并且** 排序规则与现有 `listProjectAdoptableOpenSpecChanges` 保持一致

#### 场景：oz list 快速时接口不秒级等待

- **给定** 测试夹具中 `oz list --json` 立即返回
- **且** 当前项目 workflow read model 很小
- **当** 请求 `/openspec/changes`
- **则** 响应不应被 unrelated provider history 扫描拖慢
- **并且** 测试应能证明慢路径不再依赖全项目 `getProjects()`

### 需求：现有 33/34 方向不得回退

本变更必须兼容既有两个活动提案的架构方向。

#### 场景：消息最终事实仍来自 co/wo read model

- **当** Pi workflow child session 运行中收到 realtime 事件
- **则** 页面可以刷新 read model
- **但** 最终 transcript 仍以 co durable conversation messages 为准

#### 场景：session id 不被当作 pid

- **当** workflow 只有 `state.sessions` 而没有 `state.processes`
- **则** 页面不得显示 `workflow-runner-processes`
- **且** 不得把 `pi-thread-1` 显示成 pid

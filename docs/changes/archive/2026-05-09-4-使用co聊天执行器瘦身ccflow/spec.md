## 新增需求

### 需求：ccflow 必须通过 co 文件协议提交聊天请求

系统必须移除 ccflow Web 服务直接执行 Codex/OpenCode 的职责，并改为向 co 写入标准 request 文件。

#### 场景：发送新消息时写入 co request

- **当** 用户在 Codex 或 OpenCode 会话中发送消息
- **则** ccflow 必须向 `CCFLOW_CO_HOME/requests/pending/` 原子写入 `co-request-v1` 文件
- **且** request 必须包含 `request_id`、`op`、`conversation_id`、`project_path`、`provider` 和 `text`
- **且** ccflow 不得直接 `spawn` Codex/OpenCode CLI

#### 场景：同一个会话续发消息

- **当** 用户在已有会话中再次发送消息
- **则** request 必须复用同一个 `conversation_id`
- **且** ccflow 不得要求浏览器提供可信的 provider session id
- **且** co 必须能够根据 conversation state 恢复 provider session

#### 场景：co 不可用时禁止发送

- **当** ccflow 启动或发送前执行 `co doctor --json`
- **且** co 不可用或协议版本不兼容
- **则** ccflow 必须禁用聊天发送能力并返回明确错误
- **且** 不得回退到旧的 Node 内置 runner

### 需求：co request 必须覆盖运行中干预策略

系统必须用 `active_policy` 表达用户在 active turn 期间发第二条消息时的意图。

#### 场景：运行中消息排队

- **当** 同一 `conversation_id` 已有 running turn
- **且** 新 request 的 `active_policy` 为 `queue`
- **则** co 必须在当前 turn 完成后再执行新消息

#### 场景：运行中消息中断后发送

- **当** 同一 `conversation_id` 已有 running turn
- **且** 新 request 的 `active_policy` 为 `abort_and_send`
- **且** `target_turn_id` 匹配当前 active turn
- **则** co 必须先中断当前 turn
- **且** co 必须随后在同一 `conversation_id` 中发送新消息

#### 场景：stale 干预不得误伤新 turn

- **当** request 携带的 `target_turn_id` 不匹配当前 active turn
- **且** request 会中断或 steer 当前 turn
- **则** co 必须拒绝该 request
- **且** 必须写入可被 ccflow 展示的 rejected 事件

### 需求：中断会话必须通过 co request 完成

系统必须通过 `op = abort` 的 request 中断运行中 turn。

#### 场景：用户中断运行中 turn

- **当** 用户点击停止按钮
- **则** ccflow 必须写入 `op = abort` 的 `co-request-v1`
- **且** request 必须包含 `conversation_id`
- **且** 应包含当前 UI 看到的 `target_turn_id`
- **且** ccflow 不得直接向 provider CLI 发送信号

#### 场景：co 完成中断后写入事件

- **当** co 成功中断 provider CLI
- **则** co 必须更新 turn state 为 `aborted`
- **且** 必须向 `events.jsonl` 写入 `session-aborted`
- **且** ccflow 必须 tail 到该事件并更新前端状态

### 需求：多窗口、刷新和换设备必须依赖 conversation_id 恢复

系统必须用 `conversation_id` 作为跨窗口、跨刷新和跨设备的稳定会话身份。

#### 场景：多窗口同时操作同一会话

- **当** 两个浏览器窗口对同一 `conversation_id` 写入 request
- **则** co 必须对该 conversation 串行处理请求
- **且** 必须用 `request_id` 保证重复提交不会重复执行

#### 场景：刷新网页后恢复运行中会话

- **当** 用户刷新网页
- **且** co conversation state 显示该会话仍有 active turn
- **则** ccflow 必须读取 conversation state
- **且** 必须重新 tail 对应 turn 的 `events.jsonl`

#### 场景：更换设备后接力

- **当** 用户在另一设备打开同一 ccflow 会话
- **则** ccflow 必须复用同一个 `conversation_id`
- **且** 新设备发送消息时无需知道 provider session id
- **且** co 必须根据 conversation state 继续 provider 会话

### 需求：ccflow 必须移除旧 Node runner 执行路径

系统必须删除或禁用 `ccflow-runner.js` 和 `runner-turns.js` 承担的执行职责。

#### 场景：代码中不存在旧 runner fallback

- **当** co 协议适配完成
- **则** ccflow 不得保留可被生产路径调用的 `ccflow-runner.js`
- **且** 不得保留 Web 服务直接启动 provider CLI 的 fallback

#### 场景：事件流仍兼容前端

- **当** co 写入 `events.jsonl`
- **则** ccflow 必须继续向前端广播现有可消费事件
- **且** 前端消息列表不得感知事件来源从 Node runner 变为 co

### 需求：测试必须覆盖真实操作路径

系统必须用真实业务路径测试 co request 协议和 ccflow 瘦身行为。

#### 场景：server 测试覆盖 request 文件字段

- **当** 测试模拟发送 Codex 消息
- **则** ccflow 必须写入符合 `co-request-v1` 的 message request
- **且** request 不得包含 UI 元数据或 provider 原始内部字段

#### 场景：server 测试覆盖 abort request

- **当** 测试模拟停止运行中会话
- **则** ccflow 必须写入 `op = abort` request
- **且** 不得调用旧 Node runner abort 路径

#### 场景：浏览器测试覆盖刷新恢复

- **当** co fixture 写出 running conversation state 和后续事件
- **且** 用户刷新页面
- **则** 页面必须继续展示该会话运行中状态和后续事件

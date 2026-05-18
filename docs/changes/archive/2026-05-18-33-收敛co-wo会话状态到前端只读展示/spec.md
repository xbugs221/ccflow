# 规格

### 需求：前端不得复制 co/wo 生命周期状态机

cbw 前端应只发送用户意图、展示本地 pending 反馈、读取 co/wo 权威状态并渲染结果，不得用本地 Set 或 realtime payload 作为 provider/workflow 生命周期事实源。

#### 场景：发送消息后不直接宣告 provider session running

- **当** 用户在 Codex、OpenCode 或 Pi 会话中发送消息
- **则** 前端可以显示本地 pending 用户消息和防重复提交状态
- **且** 不得仅因为点击发送就把具体 provider session 记为权威 running
- **并且** 是否显示可中断运行态必须等待 co 返回 `session-status`、`active_turn_id` 或等价 read model

#### 场景：路由刷新后运行态从 co 恢复

- **当** 用户刷新或重新打开一个仍有 `active_turn_id` 的会话
- **则** 前端应通过 `check-session-status` 或项目 read model 恢复运行态
- **且** 发送按钮应显示停止按钮
- **并且** 不得依赖刷新前遗留的前端 `processingSessions`

#### 场景：workflow 阶段状态来自 wo

- **当** 用户打开 workflow 详情或 workflow 子会话
- **则** stage、run status、当前轮次和中断状态来自 wo read model
- **且** chat 的 provider turn 状态只用于该子会话输入区是否可停止
- **并且** chat 本地状态不得覆盖 wo 展示的 stage 事实

### 需求：三 provider 的推送内容不得直接成为最终消息渲染事实

Codex、OpenCode、Pi 的 WebSocket 内容事件应只触发 ack、状态更新或 read model 刷新。最终 assistant 正文、reasoning、工具卡片和文件变更必须来自持久化会话消息 read model。

#### 场景：运行中 provider 内容事件不直接插入 transcript

- **当** Codex、OpenCode 或 Pi 在运行中推送 assistant content item
- **则** 前端不得把该 payload 直接追加为最终 assistant 消息
- **且** 可触发对应会话消息 read model 的刷新
- **并且** 页面中不得出现只存在于 realtime payload、尚未落盘的 assistant 正文

#### 场景：持久化 read model 更新后按权威顺序显示

- **当** provider 的持久化会话消息新增用户消息、assistant 正文、reasoning 或工具结果
- **且** 前端收到刷新事件或完成事件
- **则** 页面应按 read model 顺序渲染消息
- **并且** 工具卡片结构、折叠状态和正文顺序与刷新浏览器后的结果一致

#### 场景：重复推送不会重复渲染

- **当** 同一 provider 会话连续收到重复 `projects_updated`、content event 或 complete event
- **则** 同一条 assistant 正文、用户消息和工具卡片最多显示一次
- **并且** 用户滚动位置和已加载历史窗口不应被重复推送打乱

### 需求：运行中 UI 只保留停止按钮表达

底部运行状态条应删除，避免与发送按钮状态重复。

#### 场景：发送按钮变为停止按钮

- **当** 当前会话处于本地 dispatching 或 co running 状态
- **则** composer action button 应从发送变为停止
- **且** 用户能通过该按钮请求中断当前 turn
- **并且** 没有 co active turn 时不得向错误 turn 发送 abort

#### 场景：底部状态条不再出现

- **当** 当前会话正在运行
- **则** 输入框上方或底部不得显示旧的 `ProcessingStatus` 条
- **且** 页面不得显示 fake tokens、运行秒数、`esc to stop` 等旧状态条内容
- **并且** 断线提示、附件、模型选择和 follow latest 控件保持可用

### 需求：错误和超时只作为 UI 反馈，不改写权威生命周期

网络超时、provider 错误和 abort 失败应反馈给用户，但不得让前端永久持有与 co/wo 不一致的运行态。

#### 场景：网络超时后可恢复

- **当** 发送后服务端长时间没有任何 ack 或 status
- **则** 前端可以显示网络异常错误
- **且** 应清理本地 pending dispatch 状态
- **并且** 后续收到 co status 或 read model 更新时，应以 co/wo 权威状态恢复页面

#### 场景：provider 错误后状态收敛

- **当** Codex、OpenCode 或 Pi 返回 error/failed/aborted
- **则** 前端应显示错误或中断反馈
- **且** 停止按钮应按 co 返回状态消失
- **并且** 不得保留本地 processing 残留导致刷新后继续显示运行中

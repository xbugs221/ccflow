# 设计

## 当前代码判断

本次规划阶段已检查聊天核心路径：

```text
src/components/chat/hooks/useChatComposerState.ts
├─ 发送后立即 setIsLoading(true)
├─ 发送后立即 setProcessingStatus(...)
└─ 发送后调用 onSessionProcessing(effectiveSessionId)

src/components/chat/hooks/useChatRealtimeHandlers.ts
├─ 根据 session-status 写 isLoading/canAbort/processingSessions
├─ 根据 *-complete/*-error/session-aborted 清理状态
└─ 对 provider response 追加 realtime assistant message

src/components/chat/hooks/useChatSessionState.ts
├─ 会话切换时主动 check-session-status
├─ reset 时清理 loading/status
└─ processingSessions 变化会反向 setIsLoading(true)

src/hooks/useSessionProtection.ts
└─ 用前端 Set 维护 activeSessions/processingSessions
```

这些逻辑让 cbw 前端变成了第二套生命周期状态机。它既无法比 co 更准确知道 provider turn 是否运行，也无法比 wo 更准确知道 workflow stage 是否运行。前端 Set 适合做“离开页面保护”这类临时 UI 状态，不适合做 provider 或 workflow 的事实来源。

## 关键决策

### 决策 1：生命周期权威来源只保留 co/wo

```text
Manual provider session
  source of truth: co conversation state
  fields: conversation_id, provider, active_turn_id, status, turns

Workflow run
  source of truth: wo run state
  fields: run_id, stage, stages, sessions, status

cbw frontend
  responsibilities: send intent, render read model, request refresh, show local pending UI
```

前端不再在发送后主动宣告某个 provider session 正在运行。发送动作只进入本地 pending dispatch 状态；是否正在运行必须由 co 回传 `session-status` 或 read model 恢复得到。

### 决策 2：WebSocket provider 内容事件不再是最终 transcript 来源

Codex 已有 JSONL 单一来源测试基础，但当前问题涉及 Codex、OpenCode、Pi 三个 provider。三者都应遵守同一规则：

```text
provider realtime event
  ├─ message-accepted: 更新乐观用户消息为 sent
  ├─ session-status: 更新停止按钮可见性
  ├─ projects_updated / provider complete: 触发 read model reload
  ├─ error: 显示错误消息
  └─ provider content item: 不直接写入最终 assistant transcript

session messages read model
  └─ 唯一负责 assistant 正文、工具卡片、reasoning、文件变更等最终渲染
```

这样可以避免 realtime placeholder 与落盘消息同时存在，导致重复、乱序和样式不一致。

### 决策 3：前端保留很薄的 pending 状态

完全等待 co 状态会让发送后按钮短暂无反馈。允许保留本地 pending dispatch 状态，但它只能表达“请求已从浏览器发出，等待服务端确认”，不能冒充 provider turn running。

```text
idle
  -> dispatching: 用户点击发送，本地防重复和乐观用户消息
  -> accepted: 收到 message-accepted 或 session-status
  -> running: co 返回 active_turn_id/status=running
  -> idle: co 返回 complete/error/aborted 或 status=false
```

停止按钮在 dispatching 或 running 均可展示，但真正 abort 所需的 target turn 必须来自 co 的 active turn；没有 turn 时只能显示“等待启动/不可中断”状态，不能发送错误 abort。

### 决策 4：移除底部状态条

`ChatComposer` 中底部 `ProcessingStatus` 与发送按钮变成停止按钮重复。删除底部状态条后，运行中表达收敛为：

```text
composer action button
├─ idle: send
└─ pending/running: stop
```

不再显示 fake tokens、elapsed spinner、`esc to stop` 等与业务事实无关的状态。`processingStatus` 类型和状态写入可在执行阶段进一步删除或收敛，只保留仍被真实业务使用的字段。

## 风险和处理

- 风险：去掉 realtime 直接追加后，慢速持久化时 assistant 内容出现延迟。
  - 处理：收到 provider 内容事件时触发轻量 read model reload 或 debounced refresh，而不是直接渲染 payload。

- 风险：OpenCode/Pi 的持久化 read model 可能不如 Codex 测试完整。
  - 处理：测试必须覆盖三 provider 的运行中推送、完成刷新和重复通知，不允许只测 Codex。

- 风险：workflow 子会话既有 co session status，又有 wo stage status。
  - 处理：聊天停止按钮看 co active turn；workflow stage/详情看 wo run state。两者只在 UI 上组合，不互相覆盖。

- 风险：历史 `processingSessions` 还被项目刷新和离开保护使用。
  - 处理：执行阶段先查调用方，将它降级为 UI protection 或直接由 co/wo read model 派生，避免继续当作事实源。

## 测试设计

执行阶段要新增或更新这些真实测试：

- Provider 推送一致性测试：分别构造 Codex、OpenCode、Pi 会话，模拟运行中 content event，断言临时内容不进入最终 transcript；追加持久化消息并触发刷新后才显示。
- Provider 重复通知测试：对三个 provider 连续发送重复刷新/complete 事件，断言 assistant 正文和工具卡片只出现一次。
- 生命周期来源测试：模拟路由刷新后 `check-session-status` 返回 running，停止按钮恢复；模拟 status=false 后停止按钮消失。
- Workflow 子会话测试：打开 wo 运行中的 child session，断言 workflow stage 来自 wo，聊天停止按钮来自对应 co session status。
- UI 精简测试：发送后页面没有 `ProcessingStatus` 文案、tokens、`esc to stop`，但 action button 变为 stop 并能发起 abort。

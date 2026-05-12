## 新增需求

### 需求：同一网页会话连续发送消息必须实时显示每轮智能体响应

用户在同一个 `cN` 会话页面发送第 2 条及后续消息时，前端必须显示该轮智能体响应。

#### 场景：第 1 轮完成后发送第 2 条

- **给定** 用户正在 `cN` 会话页面
- **且** 第 1 条消息已经完成并显示 assistant 响应
- **当** 用户发送第 2 条消息
- **则** 用户消息必须显示为已发送
- **且** ccflow 必须写入同一个 `conversation_id = cN` 的 co request
- **且** 前端必须实时显示第 2 个 turn 的 assistant 响应
- **且** 第 1 个 turn 的 assistant 响应不得重复插入

#### 场景：第 1 轮仍运行时发送第 2 条

- **给定** 同一 `cN` conversation 已有 running turn
- **当** 用户发送第 2 条消息
- **则** ccflow 必须按 co `queue` 策略提交 request
- **当** co 开始执行 queued turn
- **则** ccflow 必须发现新的 `active_turn_id`
- **且** 前端必须显示 queued turn 的 assistant 响应

### 需求：co 实时事件必须带可路由的 ccflow 会话身份

ccflow 转发 co 事件时，必须保留当前网页路由可识别的 `cN` 身份。

#### 场景：转发第 2 个 turn 的响应事件

- **给定** co 写出第 2 个 turn 的 `codex-response` 或 `opencode-response`
- **当** ccflow tail 到该事件
- **则** WebSocket payload 必须包含 `ccflowSessionId`
- **且** WebSocket payload 必须包含 `ccflow_session_id`
- **且** `turnId` 或 `turn_id` 必须指向第 2 个 turn
- **且** 前端当前 `cN` 页面不得因为 session 过滤丢弃该事件

#### 场景：响应事件生成稳定 messageKey

- **给定** 第 1 个 turn 和第 2 个 turn 都产生 assistant 响应
- **当** 前端处理实时事件
- **则** 两条 assistant 消息必须使用不同的稳定身份
- **且** 去重逻辑不得按相同 provider session id 或相似文本误删第 2 条响应

### 需求：状态轮询不得吞掉后续响应

`check-session-status` 只用于同步处理状态，不得让当前页面忽略稍后到达的响应事件。

#### 场景：第 2 轮启动前短暂 idle

- **给定** 第 1 轮刚完成，co conversation 短暂处于 idle
- **当** 前端执行 `check-session-status`
- **则** 页面可以清理 loading 状态
- **但** 当第 2 轮响应事件随后到达时
- **则** 前端仍必须追加 assistant 响应

#### 场景：idle 状态检查不重放旧历史

- **给定** conversation 已完成且没有 active turn
- **当** 浏览器发送 `check-session-status`
- **则** ccflow 只返回 `session-status`
- **且** 不得重放旧 `codex-response` 或 `opencode-response`

### 需求：执行阶段必须能定位根因在 ccflow 还是 co

修复前必须用文件协议证据判断第 2 个 turn 的事件是否存在。

#### 场景：co 已写出第 2 轮事件

- **给定** `turns/<t2>/events.jsonl` 中存在标准 assistant response 事件
- **当** 前端没有显示该响应
- **则** 根因归入 ccflow 观察、转发、过滤或去重逻辑

#### 场景：co 未写出第 2 轮事件

- **给定** 第 2 个 request 已进入 co
- **但** 没有对应 running/completed turn 或没有标准 assistant response 事件
- **则** 执行阶段必须转入 `../co` 的 `3-保障续发turn事件回流` 提案

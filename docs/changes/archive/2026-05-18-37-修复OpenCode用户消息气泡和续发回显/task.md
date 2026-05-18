# 任务：修复 OpenCode 用户消息气泡和续发回显

## 1. 锁定回归样例

- [x] 1.1 用 `http://localhost:4001/projects/cbw/c49` 记录当前 API 只返回 assistant 的失败样例。
- [x] 1.2 在测试 fixture 中复现 `requests/done` 有 `ping/ping2`，turn 目录只有 `state.json.request_id` 的结构。
- [x] 1.3 补充 request 位于 `claimed` 或 `running` 时的发送中样例。

## 2. 修复 co read model

- [x] 2.1 `readCoConversationRequests` 增加 `claimed` 桶扫描。
- [x] 2.2 同一 request id 出现在多个桶时去重。
- [x] 2.3 读取 turn metadata 时支持 `request.json`、`state.json`、`result.json`。
- [x] 2.4 使用 turn metadata 的 `request_id` 配对 request text。
- [x] 2.5 生成稳定的 user messageKey，便于前端去重。

## 3. 保持前端发送回显稳定

- [x] 3.1 确认 session load 合并 durable transcript 时不会清掉尚未确认的 optimistic user bubble。
- [x] 3.2 durable user message 到达后，将 optimistic bubble 收敛为已确认状态。
- [x] 3.3 确认同文本不同 request id 的真实重复发送不会被去重误删。

## 4. 测试

- [x] 4.1 新增 server 测试：OpenCode 两轮 transcript 返回 user/assistant/user/assistant。
- [x] 4.2 新增 server 测试：request 在 `claimed` 时 user 消息可见。
- [x] 4.3 新增 browser 业务测试：OpenCode 第一条和第二条消息发送后都显示 user 气泡。
- [x] 4.4 新增或更新去重测试：optimistic 与 durable request 合并不重复。
- [x] 4.5 运行相关 server/spec 测试。
- [x] 4.6 运行 `oz validate 37-修复OpenCode用户消息气泡和续发回显 --json`。

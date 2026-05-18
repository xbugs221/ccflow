# 37-修复OpenCode用户消息气泡和续发回显

## 问题

参考会话 `http://localhost:4001/projects/cbw/c49` 暴露了 OpenCode 手动会话的两个用户可见问题：

- 第一条用户消息发送后，聊天区只显示 OpenCode 的 assistant 回复 `Pong!`，用户消息气泡缺失。
- 第二条用户消息发送出去后同样没有用户气泡，用户感知为消息被吞掉。

本地 co durable state 证明请求没有真正丢失：

```text
requests/done/chatreq-1779091206483-cgsl8sfw.json  text="ping"
requests/done/chatreq-1779092760994-vdvfdyl0.json  text="ping2"
conversations/c49/state.json                       turns=[turn_..., turn_...]
turns/*/state.json                                 request_id=chatreq-...
turns/*/events.jsonl                               opencode-response "Pong!"
```

但 cbw 消息 API 当前只返回两条 assistant 消息，没有把 turn state 的 `request_id` 反查回 request 文本生成 user 消息。因此刷新、切会话或第二轮续发后，OpenCode transcript 会丢失用户输入气泡。

## 目标

- OpenCode/co 会话的消息读取必须按 turn 顺序返回 user -> assistant。
- 当 turn 目录缺少 `request.json` 但 `state.json` 或 `result.json` 有 `request_id` 时，cbw 必须能反查 request 文本。
- 第二条消息发送后，即使 request 处于 claimed/running 状态，也不能从 transcript 中消失。
- 本地 optimistic user bubble 与 co durable request 回读之间应去重，不能变成重复用户消息。

## 范围

```text
cbw
├── server/co-read-model.ts
│   ├── 扫描 co requests 的 pending/running/claimed/done 桶
│   ├── 从 turn request.json、state.json、result.json 建立 turn -> request_id 映射
│   ├── 用 request.text 生成稳定 user 消息
│   └── 保持 assistant event 解析和 provider 标记
├── server/session-messages-handler.ts
│   └── 保持 cN route 走 co read model，确保 provider=opencode 不回退到 Codex
├── src/components/chat
│   └── 确认 session load / realtime 收敛时不清掉未被 durable transcript 确认的 user bubble
└── tests
    ├── server co read model 双轮 OpenCode transcript
    ├── claimed/running request 回显
    └── browser 业务流验证第二条消息不被吞
```

## 非目标

- 不修改 co 的请求/turn 文件协议。
- 不修改 OpenCode CLI 或 provider adapter。
- 不重新设计聊天 UI 样式。
- 不改变 Codex/Pi 的消息语义；如复用 co read model，只做兼容性保护。
- 不把 realtime payload 作为最终 transcript 事实源。

## 测试策略

执行阶段应在本提案的 `tests/` 目录写真实测试代码，并在归档时迁移到根 `tests/`。测试重点：

- 构造 co home：conversation `c49` 有两个 turn，turn 目录只有 `state.json/result.json/events.jsonl`，request 文本在 `requests/done`；断言消息 API 返回 `user ping`、`assistant Pong!`、`user ping2`、`assistant Pong!`。
- 构造第二条 request 位于 `requests/claimed` 或 `requests/running`，turn 尚未 complete；断言消息 API 仍返回第二条 user 消息，避免发送后被刷新吞掉。
- 浏览器业务流使用 fake co/OpenCode：创建 OpenCode 会话，发送第一条和第二条消息，刷新页面后仍能看到两条用户气泡和两条 assistant 回复。
- 去重测试：optimistic user bubble 与 durable request message 内容、request id 或 message key 相同/等价时，只显示一条。

## 开放问题

- co 是否会长期保留 `requests/claimed` 文件，还是 claimed 只存在于很短窗口？测试应覆盖该窗口，避免未来回归。
- 历史 turn 如果缺少 `state.json.request_id` 且没有 `request.json`，是否需要基于时间近似匹配 request？默认不建议做模糊匹配，避免串会话。

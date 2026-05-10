## 设计原则

本变更只修复 co/Codex 手动会话的重复历史显示，不扩大为聊天系统重构。

目标链路：

```text
页面打开已有 cN 会话
  |
  +-- REST 读取 provider session 历史
  |
  +-- check-session-status 只返回状态
        |
        +-- running: 可补发当前 active turn 的必要事件
        |
        +-- idle: 不全量 replay 历史 turn events

新一轮续聊
  |
  +-- WebSocket 推当前 turn 实时事件
  |
  +-- turn 完成后 REST/历史校准
  |
  +-- 前端按稳定 identity 合并，不重复追加
```

## 关键判断

当前重复来自两个事实叠加：

```text
持久历史已加载
  +
idle check-session-status 全量 replay conversation events
  +
frontend codex-response agent_message 无稳定去重直接 append
  =
旧消息重复显示
```

因此执行阶段应先让后端停止在 idle 状态下全量 replay，再补上前端幂等保护。只修前端会掩盖后端协议问题；只修后端则未来断线补发或多连接 replay 仍可能让重复回来。

## 后端方案

`check-session-status` 应区分状态查询与历史同步：

```text
if conversation active:
  recover active turn
  replay active turn events only when needed
  send session-status isProcessing=true

if conversation idle:
  send session-status isProcessing=false
  do not replay all historical turns by default
```

如果后续确实需要补发历史事件，应设计显式 cursor：

```text
client: { type: "sync-session-events", sessionId: "c51", afterEventKey: "..." }
server: returns only events after cursor
```

本提案不要求实现完整 cursor 协议；只要求停止当前无条件全量 replay 的错误行为。

## 前端方案

前端需要为 co/Codex 实时消息建立可比对 identity。优先使用后端事件携带的稳定字段，例如：

```text
conversation id + turn id + event line/message key
provider session id + JSONL line number/message key
clientRequestId + item id
```

消费实时事件时，若当前消息列表或已加载 `sessionMessages` 已包含相同 identity，则应更新已有消息或忽略重复事件，而不是 append 新行。

`cN` 识别也需要收敛：

```text
cN route session
  - 是稳定的 ccflow conversation id
  - 可映射 providerSessionId
  - 不等同于 unsaved new-session-* draft

new-session-*
  - 是未持久化的新会话草稿
```

执行阶段应优先拆出更明确的判断函数，避免继续用同一个 `isTemporarySessionId` 同时覆盖 `new-session-*` 和 `c\d+`。

## 测试策略

执行阶段应在本提案 `tests/` 目录先写真实测试代码：

```text
docs/changes/11-修复co续聊历史重复回放/tests/
  co-idle-status-does-not-replay-history.test.js
  chat-realtime-dedupes-replayed-co-events.test.ts
  co-session-followup-no-duplicate-history.spec.ts
```

归档或合并执行时再同步到根测试套件。

测试重点：

- server 测试要模拟 `c51` idle conversation，调用 WebSocket `check-session-status`，断言只返回 `session-status isProcessing=false`，不返回旧 `codex-response agent_message`。
- 前端测试要先放入持久历史，再投递相同 replay 事件，断言消息数量不增加。
- e2e 测试要用 fixture co home 和真实页面流程验证“不刷新连续续聊”。

## 风险

- 如果完全移除 replay，运行中断线恢复可能少看到当前 active turn 的历史事件；修复必须只禁止 idle 全历史 replay，不阻断 active turn 恢复。
- 如果前端用文本内容去重，两个不同 turn 的相同回复可能被误删；去重必须优先使用事件/消息 identity。
- 如果继续把 `cN` 当临时 session，可能导致续聊 session filter、loading reset、pending view handoff 逻辑互相干扰。
- 如果测试只断言最终刷新后的历史，会漏掉同页续聊时的重复显示。

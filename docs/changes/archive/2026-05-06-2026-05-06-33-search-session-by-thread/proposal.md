## Why

聊天全文搜索当前主要返回 transcript 可见文本的消息级命中。实际排查 Codex 工作流时，用户经常只知道 Go runner `mc`、日志或文件系统中暴露的 thread 标识，例如 `rollout-2026-04-30T00-27-02-019dda10-ba67-7973-ac49-3ae9102d38cd.jsonl` 对应的 `019dda10-ba67-7973-ac49-3ae9102d38cd`。这个 thread 也是 `codex resume` 需要传入的恢复标识，但未必出现在消息正文里，因此现有搜索会返回空结果，用户无法从已知 thread 快速打开并继续会话。

同时，JSONL 文件名搜索和 transcript 内容搜索的语义不同。混在同一个输入里会让结果类型、排序、重复命中和点击行为都变得含糊。搜索弹窗应让用户先明确选择“JSONL 文件名/thread”或“文件内容”，再按所选模式搜索。

## What Changes

- 在现有左侧导航栏搜索弹窗中加入搜索模式选择，不另建独立页面。
- 搜索模式分为 `JSONL 文件名/thread` 和 `文件内容` 两类，二者互斥，不混合返回。
- 对 Codex JSONL 文件名建立 thread 派生规则：优先移除 `rollout-<timestamp>-` 前缀和 `.jsonl` 后缀，得到可传给 `codex resume` 的稳定 thread；不匹配时回退到 basename。
- 搜索结果协议支持 `message` 与 `session` 两类结果：`文件内容` 模式返回消息命中并保持现有定位能力，`JSONL 文件名/thread` 模式返回会话命中并负责打开会话。
- 前端搜索面板展示 thread 命中的会话身份，点击后进入对应会话，不要求 `messageKey`。
- workflow-owned Codex child session 的搜索结果必须保留 `mc` 输出的 thread，使后续继续发送消息仍恢复同一 Codex thread。
- 增加真实业务验收：按 thread 段、完整文件名、无正文命中三种方式搜索 Codex 会话。

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `chat-history-full-text-search`: 扩展搜索范围与结果协议，使会话 thread/jsonl 文件名可用于发现并打开会话。

## Impact

- 后端影响：`server/projects.js` 的 Codex 会话索引与 `/api/chat/search` 需要携带/匹配 JSONL 文件名派生 thread，并返回会话级结果；thread 必须保持为 Codex resume 标识。
- 前端影响：`ChatHistorySearchDialog` 需要增加互斥搜索模式选择；搜索跳转逻辑需要支持没有 `messageKey` 的会话级结果。
- 验收影响：扩展 `tests/spec/chat-history-full-text-search.spec.js` 或新增专门回归测试，覆盖模式选择、Codex thread 搜索、内容搜索隔离和点击打开。

## Context

来源于源码：

- 当前全局搜索入口是 `/api/chat/search`，由 `searchChatHistory(query)` 返回 `results`。
- 现有搜索主要把 Claude/Codex transcript 解析成消息级文本，再用 `messageKey` 支持点击后滚动和高亮。
- Codex 会话索引读取 `~/.codex/sessions/**.jsonl`，`parseCodexSessionFile(filePath)` 已经持有文件路径，但对有 `session_meta` 的文件优先使用 `payload.id` 作为 session id。
- 前端 `ChatHistorySearchDialog` 当前只有一个输入框，假设每条结果都有 `messageKey`，点击时总是带 `chatSearch` 和 `messageKey`。
- Codex resume 参数由 `buildCodexExecArgs` 通过 `codex exec --json ... resume <sessionId>` 传入。
- Go runner read model 会把 `process.sessionId/process.session_id/process.threadId/process.thread_id` 归一为 workflow process `sessionId`，并用它创建 workflow-owned Codex child session。

推断：

- 用户口中的 thread 是从 JSONL 文件名派生、由 `mc` 输出、并能传给 `codex resume` 的恢复标识。它不是单纯展示别名。
- 最小变更应扩展现有搜索弹窗与结果协议，而不是新增独立页面。

## Target Shape

```
User query
   |
   v
/api/chat/search?mode=...
   |
   +-- mode=content
   |     |
   |     +-- transcript visible text -> resultType=message + messageKey
   |
   +-- mode=jsonl
         |
         +-- session identity fields -> resultType=session
               |
               +-- provider session id
               +-- codex jsonl filename
               +-- codex derived thread
```

搜索结果协议建议：

```
ChatSearchResult
├─ resultType: "message" | "session"
├─ projectName / projectDisplayName
├─ provider
├─ sessionId              # Codex 使用可 resume 的 thread；Claude 使用原 session id
├─ sessionSummary
├─ thread?                # Codex 文件名派生标识
├─ sessionFileName?       # 可展示/匹配，不暴露绝对路径
├─ messageKey?            # 仅 message 结果需要
└─ snippet
```

UI 结构建议：

```
Search dialog
├─ segmented control
│  ├─ JSONL 文件名/thread
│  └─ 文件内容
├─ search input
└─ results
   ├─ mode=jsonl: session rows
   └─ mode=content: message rows
```

## Thread Derivation

Codex 文件名解析规则：

```
rollout-2026-04-30T00-27-02-019dda10-ba67-7973-ac49-3ae9102d38cd.jsonl
└───── timestamp prefix ─────┘└──────────── thread ────────────┘
```

建议正则只匹配文件 basename：

```
^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$
```

如果不匹配，使用去掉 `.jsonl` 的 basename 作为 `thread`。这样兼容旧测试 fixture、非 rollout 文件名和未来 Codex 文件名变化。

## Key Decisions

- Codex 搜索结果和 Codex session read model 中，`session.id/sessionId` 应收敛为可传给 `codex resume` 的 thread。完整 JSONL basename 只作为 `sessionFileName`/匹配字段保留。
- 如果 `session_meta.payload.id` 与文件名派生 thread 不一致，优先确认 Codex CLI 实际 resume 所需标识；本变更按用户约束采用文件名派生 thread 作为恢复标识。
- 搜索模式必须显式且互斥。`mode=jsonl` 只搜 JSONL 文件名/thread 等会话身份；`mode=content` 只搜 transcript 可见内容。
- 不把 thread 命中伪装成消息命中。会话级结果没有自然 `messageKey`，应让前端按 `resultType=session` 打开会话顶部或当前加载位置。
- 不暴露绝对 JSONL 路径到前端。搜索结果只需要文件名和 thread，避免泄漏本机目录结构。
- 不做混合搜索结果去重，因为两种数据源不会在同一次查询中混合返回。

## Risks

- Codex 文件名和 `session_meta.payload.id` 不一致时，现有代码若继续使用 payload id 可能导致 `codex resume` 参数不符合 `mc` 输出的 thread。实现时需要统一 search、workflow child session、message read、resume 的 id 语义。
- 当前前端跳转依赖 `projects` 缓存中的 `routeIndex`。搜索结果若来自游离 Codex 文件，仍需沿用现有 orphan Codex 搜索修复的项目解析逻辑。
- 大量 Codex 文件下，`mode=jsonl` 应复用已有索引并避免解析全文；`mode=content` 继续承担 transcript 扫描成本。
- 旧调用方如果未传 mode，需要定义默认行为。建议前端始终传 mode；后端可默认 `content` 保持现有语义。

## Out Of Scope

- 不新增单独的 thread 搜索页面或高级筛选语法。
- 不改变 Codex/Claude 原始 JSONL 文件格式。
- 不迁移已有 project config。

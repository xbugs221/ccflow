# 设计

## 当前判断

项目发现目前把“有哪些仓库”和“每个 session 的完整详情”耦合在一起。Codex 的 `parseCodexSessionFile()` 会逐行解析整个 JSONL，以获得摘要、消息数、时间和 cwd；但项目列表只需要 cwd、id、标题或时间等轻量字段。

真实数据源已经确认：

```text
Codex
  files: ~/.codex/sessions/**/*.jsonl
  first line: {"type":"session_meta","payload":{"cwd": "..."}}

Pi
  files: ~/.pi/agent/sessions/<encoded-project>/*.jsonl
  first line: {"type":"session","cwd": "..."}

OpenCode
  db: ~/.local/share/opencode/opencode.db
  table: session
  key columns: id, title, directory, time_created, time_updated, project_id
```

因此本变更把 Provider 索引拆成：

```text
project/session overview index
  cheap, cached, enough for /api/projects

session detail reader
  deep parse or provider-specific message read
  only used when entering a session or loading messages
```

## 决策 1：Codex 头部索引

新增只读首条非空 JSONL 的解析函数：

```text
readJsonlFirstRecord(filePath)
parseCodexSessionHeader(filePath)
```

字段映射：

```text
id              deriveCodexThreadFromJsonlPath(filePath).thread
sourceSessionId payload.id
cwd             payload.cwd
model           payload.model || payload.model_provider
createdAt       payload.timestamp || line.timestamp || file birth/mtime
lastActivity    file mtime 或 line.timestamp
summary         persisted override || "Codex Session"
messageCount    unknown/0 for overview
```

如果第一条非空记录不是 `type=session_meta`，才调用现有 `parseCodexSessionFile()` 深读，兼容旧格式或测试夹具。

## 决策 2：Pi 头部索引

Pi session JSONL 的首行就是 session metadata：

```json
{"type":"session","version":3,"id":"...","timestamp":"...","cwd":"..."}
```

新增 Pi 文件索引：

```text
listPiSessionFiles(root = ~/.pi/agent/sessions)
parsePiSessionHeader(filePath)
buildPiSessionsIndex()
```

字段映射：

```text
id            record.id || filename uuid
cwd           record.cwd
createdAt     record.timestamp || filename timestamp
lastActivity  file mtime
provider      pi
summary       persisted override || "Pi Session"
```

Pi 概览不扫描整条 transcript。消息详情继续走现有 co/Pi read model 或 Provider-specific message loader，不能在项目发现阶段读取全部 turns。

## 决策 3：OpenCode SQLite 轻量查询

OpenCode 当前版本的 `opencode session list --format json` 实际读取：

```text
~/.local/share/opencode/opencode.db
```

项目发现应优先用仓库已有 Node SQLite 依赖只读查询：

```sql
select id, title, directory, time_created, time_updated, project_id, agent, model
from session
where directory is not null and directory <> ''
order by time_updated desc
```

只读 DB 失败时才 fallback 到当前 CLI：

```text
opencode session list --format json
```

不得扫描以下目录作为项目发现入口：

```text
~/.local/share/opencode/snapshot
~/.local/share/opencode/tool-output
~/.local/share/opencode/storage/session_diff
~/.local/state/opencode/prompt-history.jsonl
~/.local/state/opencode/frecency.jsonl
```

这些目录是 snapshot、工具输出、diff 或输入历史，不是 session 主索引。

## 决策 4：统一 Provider Index Cache

为三类 Provider 各自保留 TTL/promise cache：

```text
codexSessionsIndexCache
piSessionsIndexCache
opencodeSessionsIndexCache
```

同一轮 `getProjects()` 中通过 `indexRef` 复用结果。并发请求遇到正在构建的索引时复用 promise，避免重复 I/O。

缓存失效条件：

- TTL 到期。
- session 创建、删除、重命名、UI state 写入后清理相关 cache。
- 用户手动刷新项目时允许清理 project snapshot，但不应强制深读所有历史。

## 决策 5：项目概览限制深度字段

`/api/projects` 应返回侧边栏和项目主页需要的概览字段：

```text
id
title/summary
createdAt
lastActivity
cwd/projectPath
provider
routeIndex
favorite/pending/hidden
workflow ownership metadata
```

以下字段不应要求项目发现热路径全量解析：

```text
exact messageCount
first user message from full transcript
last assistant message
full token usage
full tool call summary
```

这些字段可在进入会话、搜索历史或加载消息时按需读取。

## 风险

- 风险：部分 Codex 旧 JSONL 首行没有 `session_meta`。
  - 处理：fallback 到现有完整解析。

- 风险：Pi 目录名可推导路径，但文件首行 cwd 更权威。
  - 处理：优先使用首行 cwd；缺失时才考虑从目录名解码。

- 风险：OpenCode DB schema 后续变化。
  - 处理：查询失败时 fallback CLI，并在测试中约束当前支持 schema。

- 风险：概览轻量化导致 UI 依赖 messageCount 或摘要变化。
  - 处理：测试覆盖 sidebar/project overview 的真实可见行为，必要时保留 persisted summary override。

- 风险：隐藏/收藏/待处理状态和 workflow child session 过滤依赖 project config。
  - 处理：轻量 index 只替代 Provider 原始历史扫描，不替代 cbw project config 叠加逻辑。

## 测试设计

- `tests/server/provider-fast-discovery-codex.test.ts`：构造 Codex JSONL，首行为 `session_meta`，后续写入大量无关或非法 JSONL，断言项目发现只依赖头部且返回稳定 cwd/id/provider。
- `tests/server/provider-fast-discovery-pi.test.ts`：构造 Pi JSONL 首行 `type=session`，断言按 cwd 分组并生成 Pi session 概览。
- `tests/server/provider-fast-discovery-opencode.test.ts`：构造临时 OpenCode SQLite DB，断言直接查询 `session` 表，不调用 CLI。
- `tests/server/provider-index-cache.test.ts`：并发调用项目发现，断言同一 Provider 索引只构建一次。
- `tests/server/multi-provider-project-overview.test.ts`：同一项目存在 Codex、Pi、OpenCode session，断言 provider、routeIndex、UI state、workflow ownership 不混淆。
- `tests/spec` 或现有 server API 测试：验证进入 session 后仍能加载真实消息，项目概览轻量化不破坏聊天详情。

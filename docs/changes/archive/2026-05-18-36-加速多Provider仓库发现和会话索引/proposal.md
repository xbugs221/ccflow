# 加速多Provider仓库发现和会话索引

## 问题

当前 `/api/projects` 的项目发现会把 Provider 会话历史也放进热路径。实测本机 Codex 历史为：

```text
~/.codex/sessions/**/*.jsonl  597 files
total size                    ~608M
getProjects()                 ~2.9s - 3.1s
```

但项目归属并不需要全量解析历史。Codex JSONL 的第 1 行就是 `session_meta`，其中 `payload.cwd` 是仓库路径；Pi JSONL 的第 1 行是 `type=session`，其中 `cwd` 也是仓库路径；OpenCode 当前版本的主会话历史不是 JSONL，而是 SQLite：

```text
Codex:    ~/.codex/sessions/**/*.jsonl
Pi:       ~/.pi/agent/sessions/**/*.jsonl
OpenCode: ~/.local/share/opencode/opencode.db
```

本机对照：

```text
fd 找 Codex JSONL 文件                    ~0.01s
rg 找 Codex session_meta                  ~0.08s
只读每个 Codex JSONL 首行再解析            ~0.16s
全量 jq 解析 608M Codex JSONL              ~3.98s
```

这说明慢点不是文件发现，而是项目列表请求在做不必要的深度会话解析。随着 Codex、Pi、OpenCode 历史增长，侧边栏和项目列表会继续变慢。

## 目标

- `/api/projects` 项目发现不得为了知道有哪些仓库而全量解析 Provider 历史。
- Codex 项目发现只读取 JSONL 头部 `session_meta`，旧格式才 fallback 深读。
- Pi 项目发现只读取 JSONL 头部 `type=session`，从 `cwd` 归属仓库。
- OpenCode 项目发现直接只读查询 SQLite `session` 表，避免 spawn CLI 和扫描大文件辅助目录。
- 三个 Provider 共享同一轮刷新缓存或 promise cache，避免并发重复扫描。
- 保持现有项目路由、session routeIndex、自定义标题、收藏、待处理、隐藏和 workflow child session 归属稳定。

## 范围

- 增加 Codex JSONL header 解析和索引构建，只读取第一条非空 JSONL。
- 增加 Pi JSONL header 解析和索引构建，覆盖 `~/.pi/agent/sessions/<encoded-project>/*.jsonl`。
- 增加 OpenCode SQLite 轻量索引读取，查询 `session(id,title,directory,time_created,time_updated,project_id,agent,model)`。
- 改造 `getProjects()` 和 Provider session population，使项目概览优先使用轻量索引。
- 限制 `/api/projects` 返回概览所需的最近 session 元数据；完整消息和深度统计按项目或 session 详情懒加载。
- 补充真实业务测试，覆盖三类 Provider 的项目发现、缓存和详情懒加载边界。

## 非目标

- 不迁移 Codex、Pi、OpenCode 的历史数据格式。
- 不依赖 `jq`、`rg`、`sqlite3` CLI 作为生产运行时。
- 不重写 OpenCode CLI 或数据库 schema。
- 不重做侧边栏 UI 和排序交互。
- 不改变聊天消息详情接口的语义。
- 不处理 workflow read model 之外的全局性能问题。

## Provider 数据源

```text
Provider discovery
  Codex
    source: ~/.codex/sessions/**/*.jsonl
    fast path: first non-empty line, type=session_meta
    project path: payload.cwd
    fallback: existing full parse

  Pi
    source: ~/.pi/agent/sessions/**/*.jsonl
    fast path: first non-empty line, type=session
    project path: cwd
    fallback: skip malformed file or deep parse only if format requires it

  OpenCode
    source: ~/.local/share/opencode/opencode.db
    fast path: readonly query session table
    project path: session.directory
    fallback: existing CLI session list only when DB is unavailable
```

## 测试策略

执行阶段需要在 `docs/changes/36-加速多Provider仓库发现和会话索引/tests/` 编写真实测试代码，再按来源迁移到根 `tests/`。测试必须证明：

- Codex 只读 JSONL 头部即可发现项目，后续大内容或坏内容不会拖慢项目发现。
- Pi 只读 JSONL 头部即可发现项目和 session 归属。
- OpenCode 通过 SQLite `session` 表读取项目和会话概览，不需要 spawn CLI。
- 同一项目同时存在 Codex、Pi、OpenCode session 时，项目身份和 session provider 不混淆。
- session 详情仍能按需读取真实消息，不因概览轻量化丢失业务能力。

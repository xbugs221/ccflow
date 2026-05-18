# 任务

## 1. 建立轻量 Provider 索引测试夹具

- [x] 1.1 构造 Codex JSONL fixture，首行为 `session_meta`，后续包含大量或非法内容。
- [x] 1.2 构造 Codex 旧格式 fixture，验证首行不可用时 fallback 深读。
- [x] 1.3 构造 Pi JSONL fixture，首行为 `type=session` 且包含 cwd。
- [x] 1.4 构造 OpenCode SQLite fixture，包含 `session` 表和多项目记录。
- [x] 1.5 构造同项目多 Provider fixture，覆盖 Codex、Pi、OpenCode 混合归属。

## 2. 实现 Codex 头部索引

- [x] 2.1 新增读取 JSONL 第一条非空记录的共享工具函数。
- [x] 2.2 新增 `parseCodexSessionHeader`，从 `session_meta.payload.cwd` 生成轻量 session 元数据。
- [x] 2.3 修改 Codex index 构建，优先走 header fast path。
- [x] 2.4 保留首行非 `session_meta` 时的现有完整解析 fallback。
- [x] 2.5 确认 Codex summary override、model state、UI state、workflow ownership metadata 仍能叠加。

## 3. 实现 Pi 头部索引

- [x] 3.1 新增 Pi session 文件发现，扫描 `~/.pi/agent/sessions/**/*.jsonl`。
- [x] 3.2 新增 `parsePiSessionHeader`，从首行 `type=session` 提取 id、cwd、timestamp。
- [x] 3.3 新增 Pi session index cache，按 normalized project path 分组。
- [x] 3.4 将项目发现中的 Pi session 来源从仅 project config 扩展到 Pi 历史头部索引。
- [x] 3.5 确认 Pi workflow child session 和普通 Pi manual session 不混淆。

## 4. 实现 OpenCode SQLite 轻量索引

- [x] 4.1 新增 OpenCode DB 路径解析，默认 `~/.local/share/opencode/opencode.db`。
- [x] 4.2 用只读 SQLite 查询 `session` 表生成 OpenCode session index。
- [x] 4.3 DB 不存在或 schema 不兼容时 fallback 到现有 CLI。
- [x] 4.4 移除项目发现中对 OpenCode CLI 的不必要重复 spawn。
- [x] 4.5 明确不扫描 snapshot、tool-output、session_diff、prompt-history、frecency 作为项目发现入口。

## 5. 收敛 `/api/projects` 热路径

- [x] 5.1 让 `getProjects()` 复用 Provider index cache/promise，而不是每次重建全量历史索引。
- [x] 5.2 限制项目概览只依赖轻量 session 元数据和 cbw config 叠加。
- [x] 5.3 保持 project routePath、displayName、manualSessionNextRouteIndex 和 session routeIndex 稳定。
- [x] 5.4 保持 hidden/favorite/pending 和 workflow-owned session 过滤行为。
- [x] 5.5 确认搜索历史或消息详情仍可触发深读，不被概览轻量化破坏。

## 6. 编写真实测试

- [x] 6.1 在 `docs/changes/36-加速多Provider仓库发现和会话索引/tests/` 编写 Codex header fast-path 测试。
- [x] 6.2 编写 Pi header fast-path 测试。
- [x] 6.3 编写 OpenCode SQLite fast-path 测试。
- [x] 6.4 编写 Provider index cache 测试，覆盖并发或同轮复用。
- [x] 6.5 编写多 Provider 项目概览测试，覆盖 provider 身份、UI state 和 workflow ownership。
- [x] 6.6 编写会话详情回归测试，证明 Codex/Pi/OpenCode 详情读取仍可按需深读。
- [x] 6.7 执行阶段将测试按来源命名移动到根 `tests/`，并更新旧测试预期。

## 7. 验证

- [x] 7.1 运行新增 server 测试。
- [x] 7.2 运行受影响的项目发现、sidebar、workflow child session 测试。
- [x] 7.3 运行 `pnpm run typecheck`。
- [x] 7.4 运行 `oz validate 36-加速多Provider仓库发现和会话索引 --json`。
- [x] 7.5 本机复测 `getProjects()` 耗时，记录优化前后的数量级变化。

## 执行记录

- 旧测试 `projects.codex-messages.test.ts` 中“项目概览摘要来自第一条真实用户消息”的断言与本变更新意图冲突：`/api/projects` 不再为了摘要深读 Codex transcript。已更新为断言概览使用轻量默认标题，并通过 `getCodexSessionMessages()` 继续验证详情按需深读真实消息。
- 本机冷刷新复测：`getProjects()` 返回 20 个项目、418 个 Codex session、111 个 Pi session、74 个 OpenCode session，耗时约 249ms。提案记录的优化前基线为约 2.9s - 3.1s。

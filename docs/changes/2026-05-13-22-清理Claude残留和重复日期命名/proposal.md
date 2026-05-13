## 问题

历史提案 `2026-05-09-3-拆分runner并移除Claude` 已明确要求移除 Claude provider，且设计中写明“不做兼容层”。当前仓库仍保留一些旧边界：

- `server/claude-sdk.js` 作为 unsupported compatibility module 可被测试和代码继续导入。
- `tests/server/claude-sdk.unsupported.test.js`、`tests/spec/upstream-critical-fixes.spec.js` 等测试仍以旧 Claude SDK 模块存在为前提。
- 前端聊天状态仍使用 `claudeStatus` / `ClaudeStatus` 命名承载通用 provider 处理中状态。
- `shared/modelConstants.js` 仍暴露 `CLAUDE_MODELS` 空常量。
- README、部分文档和测试文件名仍表达旧 Claude provider 或重复日期前缀，容易让后续维护者误判当前支持面。
- 多个测试文件和归档提案目录存在 `2026-05-11-2026-05-11-*` 这类重复日期前缀。

这些残留会干扰后续把 ccflow 收敛为轻薄 Web 外壳，也会让 Go/Gin 后端迁移时复制旧包袱。

## 目标

本次变更先做清理，不改变业务能力：

- 删除可导入的 Claude SDK 兼容模块和依赖它存在的测试。
- 删除或改名前端通用处理中状态里的 Claude 命名。
- 删除 Claude provider 模型常量和相关断言。
- 清理 README 和内部文档中把 Claude 写成当前支持 provider 的文案。
- 去重重复日期前缀的测试文件和归档提案目录名，并同步更新引用。

## 范围

- `server/claude-sdk.js` 及其直接测试。
- `src/components/chat/**` 中只承担通用处理中状态的 `claudeStatus` / `ClaudeStatus` 命名。
- `shared/modelConstants.js` 中的 Claude provider 空常量。
- README、manual provider runner 文档、legacy Claude guard 测试中的过期断言。
- 根 `tests/` 和 `docs/changes/archive/` 中重复日期前缀命名。
- Playwright config 和文档中指向旧文件名的引用。

## 非目标

- 不移除 TaskMaster 作为第三方项目名称或上游文档链接中的 Claude 字样。
- 不移除 `CLAUDECODE` 环境变量清理逻辑；这是防止 Codex/OpenCode 子进程被误判嵌套运行的运行时保护。
- 不迁移后端到 TypeScript 或 Go。
- 不改变 co/wo 协议、聊天发送、工作流展示和 shell/file 功能。

## 测试意图

执行阶段需要新增或更新真实测试：

- 静态守卫测试：仓库生产源码中不存在 `server/claude-sdk.js` 导入、`CLAUDE_MODELS` 导出和 `ClaudeStatus` 组件。
- 业务测试：手动会话 provider 仍只接受 `codex | opencode`，`claude` 请求明确失败。
- 文件名测试：重复日期前缀文件和归档目录不存在，Playwright config 指向新文件名。
- 文案测试：README 不把 Claude 描述为当前聊天 provider。

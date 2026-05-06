## Why

ccflow 从 `siteboon/claudecodeui` fork 后已经深度分叉，不能直接合并上游主线。上游近期仍有一组高价值、小范围修复，本变更只承担其中两类**已经能在 ccflow 当前架构里独立落地**的安全和兼容性收紧：

1. 命令 frontmatter 的安全解析（杜绝 `gray-matter` 的 js / javascript / json executable engine）。
2. Claude Agent SDK 自定义 CLI 路径（`CLAUDE_CLI_PATH`）正确传入 `pathToClaudeCodeExecutable`。

同时，本变更将既有但未被验证的**关键运行时语义**（Codex permission、workflow 自动运行、二进制下载、Service Worker 缓存）从“源码字符串匹配”级别提升为**行为级回归保护**，防止后续重构在没有真正落地修复的前提下让任务被错误标记为已完成。

本变更显式不承担：上游 CloudCLI 品牌、AGPL 迁移、npm lock、服务端 TypeScript 模块化等高冲突改动；以及 `@openai/codex-sdk` / `@anthropic-ai/claude-agent-sdk` 的版本升级（升级评估属于后续独立变更，本变更只锁定现有语义）。

## What Changes

- 新增安全 frontmatter 解析入口（`server/utils/frontmatter.js`），禁用 `gray-matter` 对 `js`、`javascript`、`json` frontmatter engine 的可执行解析能力。
- 将命令解析路径统一切换到安全解析入口，覆盖 `server/utils/commandParser.js` 与 `server/routes/commands.js`。
- 在 `server/claude-sdk.js` 中补齐 `CLAUDE_CLI_PATH → pathToClaudeCodeExecutable` 的传递；并暴露 `__mapCliOptionsToSDKForTest`，以行为测试断言该传递不破坏既有 options。
- 在 `server/openai-codex.js` 中暴露 `__mapPermissionModeToCodexOptionsForTest`，以行为测试锁定 `default | acceptEdits | bypassPermissions` 与 `(sandboxMode, approvalPolicy)` 的映射。
- 在 `tests/spec/upstream-critical-fixes.spec.js` 中将既有验收从“源码 regex 匹配”重写为**行为级测试**：
  - 通过沙盒化 `self` + `caches` 实际执行 `public/sw.js`，断言 activate 清理 legacy cache 且 fetch handler 不再 respondWith。
  - 通过临时 Express 实例 + `sendDownload` 对二进制 fixture 做端到端字节比对。
  - 通过实际调用 SDK options 构造函数与 permission 映射函数验证语义稳定。

## Capabilities

### New Capabilities

- `upstream-critical-fixes`: 覆盖上游可独立验证的安全与运行时兼容修复的吸收策略、行为级验收条件和回归保护。

### Modified Capabilities

- `slash-command-catalog`: 命令 markdown frontmatter 解析必须安全处理非 YAML frontmatter。
- `binary-safe-editor-workflow`: 文件下载必须保持二进制内容不变，且前端下载流程不得使用 `response.text()` 转码。
- `chat-message-submission-idempotency`: SDK 自定义 CLI 路径的传递不得破坏现有消息提交与会话恢复行为。

## Impact

- `server/utils/frontmatter.js`: 新增安全 frontmatter 解析 helper（已落地）。
- `server/utils/commandParser.js`: 改用安全 frontmatter 解析（已落地）。
- `server/routes/commands.js`: 命令列表解析改用安全 frontmatter 解析（已落地）。
- `server/claude-sdk.js`: 补齐 `CLAUDE_CLI_PATH → pathToClaudeCodeExecutable` 传递；新增 `__mapCliOptionsToSDKForTest` 测试导出。
- `server/openai-codex.js`: 新增 `__mapPermissionModeToCodexOptionsForTest` 测试导出。
- `tests/spec/upstream-critical-fixes.spec.js`: 重写为行为级验收测试。
- `public/sw.js`、`server/project-file-operations.js`、`src/components/file-tree/hooks/useFileTreeOperations.ts`: 不修改源码，本变更只为这些既有实现增加行为级回归保护。

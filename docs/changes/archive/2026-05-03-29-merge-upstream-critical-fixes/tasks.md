## 1. 安全 frontmatter 解析

- [x] 1.1 新建 `server/utils/frontmatter.js`，导出 `parseFrontmatter(content)`，默认只信任 YAML frontmatter。
- [x] 1.2 在 `parseFrontmatter` 中禁用 `js`、`javascript`、`json` engines，确保这些 frontmatter 不执行、不产出可信 metadata。
- [x] 1.3 修改 `server/utils/commandParser.js`，将 `matter(content)` 替换为 `parseFrontmatter(content)`。
- [x] 1.4 修改 `server/routes/commands.js`，命令扫描 metadata 解析统一使用 `parseFrontmatter(content)`。
- [x] 1.5 验收：`node --test tests/spec/upstream-critical-fixes.spec.js --test-name-pattern "frontmatter|YAML|JavaScript|JSON"` 全部通过（行为级测试：通过 `parseFrontmatter` 实际调用并断言 JS 副作用未触发、JSON metadata 不被信任）。

## 2. Claude CLI 路径与 SDK options

- [x] 2.1 检查 `server/claude-sdk.js` 的 SDK options 构造逻辑，确认 `CLAUDE_CLI_PATH` 当前未被传入 SDK。
- [x] 2.2 当 `process.env.CLAUDE_CLI_PATH` 存在时，将其写入 Claude Agent SDK 支持的 `pathToClaudeCodeExecutable` option。
- [x] 2.3 确认该改动不覆盖 `cwd`、`permissionMode`、`allowedTools`、`model`、`resume`、`systemPrompt`、`settingSources`。
- [x] 2.4 暴露 `__mapCliOptionsToSDKForTest`，使行为测试可以直接构造 options 并断言 `pathToClaudeCodeExecutable` 与其他字段共存。
- [x] 2.5 验收：`node --test tests/spec/upstream-critical-fixes.spec.js --test-name-pattern "CLAUDE_CLI_PATH"` 全部通过。

## 3. Codex / 工作流自动运行 permission 行为锁定

- [x] 3.1 暴露 `__mapPermissionModeToCodexOptionsForTest`，让 spec 直接断言 `default | acceptEdits | bypassPermissions` 与 `(sandboxMode, approvalPolicy)` 的映射稳定。
- [x] 3.2 通过 `__buildCodexExecArgsForTest` 验证 `bypassPermissions` 路径会向 Codex CLI 传递 `--sandbox danger-full-access` 与 `approval_policy=` 覆盖。
- [x] 3.3 通过 `resolveWorkflowAutoRunPermissionMode` 行为测试验证后端托管 workflow 阶段默认仍为 `bypassPermissions` 且仍可被 `CCFLOW_WORKFLOW_AUTORUN_PERMISSION` 环境变量覆盖。
- [x] 3.4 验收：`node --test tests/spec/upstream-critical-fixes.spec.js --test-name-pattern "Codex permission|workflow auto-run"` 全部通过。

> 备注：本变更不再承诺 `@openai/codex-sdk` / `@anthropic-ai/claude-agent-sdk` 的版本升级。SDK 升级评估属于后续独立变更；本变更只锁定现有 permission / 自动运行语义不被回归破坏。

## 4. 二进制下载：行为级回归保护

- [x] 4.1 通过 `sendDownload` + 临时 Express 实例对 null byte / 高位字节 / ASCII 混合的二进制 fixture 做端到端字节比对，确认服务端下载链路不会经过 UTF-8 转码。
- [x] 4.2 在 `useFileTreeOperations.ts` 的 `downloadEntry` 块内断言走 `response.blob()`，且禁止该块出现 `response.text()`，避免前端将二进制响应误转字符串。
- [x] 4.3 验收：`node --test tests/spec/upstream-critical-fixes.spec.js --test-name-pattern "Binary file download|Frontend download flow"` 全部通过。

## 5. Service Worker 缓存：行为级回归保护

- [x] 5.1 在沙盒化的 `self` + `caches` 环境中执行 `public/sw.js`，断言 activate 阶段会枚举并删除所有遗留 cache，并调用 `registration.unregister()` 与 `clients.claim()`。
- [x] 5.2 在同一沙盒中模拟一次 navigate 请求，断言 fetch handler 不会调用 `respondWith()`，确保旧 SW 不再固定旧 HTML 或旧 hashed assets。
- [x] 5.3 验收：`node --test tests/spec/upstream-critical-fixes.spec.js --test-name-pattern "Service worker"` 全部通过。

## 6. 总体验收

- [x] 6.1 运行 `openspec/changes/29-merge-upstream-critical-fixes/test_cmd.sh`，确认本变更全部行为级验收测试通过。
- [x] 6.2 运行相关现有回归测试：`node --test tests/server/commands.test.js tests/server/claude-sdk.permissions.test.js tests/server/openai-codex.args.test.js tests/server/openai-codex.events.test.js tests/server/workflow-auto-runner.permissions.test.js`。
- [x] 6.3 验收：本变更测试和相关现有回归测试全部通过，且没有引入上游大型架构、品牌、许可或包管理器变更。

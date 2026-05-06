## Context

ccflow 当前仍采用以 JavaScript 文件为主的扁平后端结构：命令解析在 `server/utils/commandParser.js` 与 `server/routes/commands.js`，Claude SDK 集成在 `server/claude-sdk.js`，Codex SDK 集成在 `server/openai-codex.js`。上游 claudecodeui 已迁移到 CloudCLI 品牌和模块化 provider/database/websocket 架构，但本变更不跟随该大型重构。

## Goals / Non-Goals

**Goals:**

- 吸收上游可独立落地的安全修复（frontmatter executable engine 禁用）。
- 补齐 `CLAUDE_CLI_PATH` 在 SDK 模式下生效。
- 把已经存在但未被验证的关键运行时语义（Codex permission、workflow 自动运行、二进制下载、Service Worker 缓存）从“源码字符串匹配”级别升到**行为级回归保护**，防止后续重构在没有真正落地修复的前提下让任务被错误标记为已完成。
- 所有修复必须能单独回滚，不依赖上游主线合并。

**Non-Goals:**

- 不合并上游 CloudCLI 包名、README 品牌、AGPL 许可迁移。
- 不引入上游 npm `package-lock.json`，继续使用 `pnpm-lock.yaml`。
- 不迁移到上游 `server/modules/*` TypeScript provider/database 架构。
- 不引入上游 command palette、Docker sandbox、i18n 扩展等产品功能。
- **不升级 SDK 依赖**。`@openai/codex-sdk` 与 `@anthropic-ai/claude-agent-sdk` 的版本升级评估属于后续独立变更；本变更只锁定现有 permission / 自动运行语义不被回归破坏。

## Decisions

### 1. 创建本地安全 frontmatter helper

新增 `server/utils/frontmatter.js`，导出 `parseFrontmatter(content)`。该 helper 内部仍使用 `gray-matter`，但显式设置 YAML 语言，并将 `js`、`javascript`、`json` engines 替换为空解析器（返回 `{}`）。

替代方案：完全替换 `gray-matter`。拒绝原因：会扩大行为变化，当前只需要禁用高风险 engine。

### 2. 命令解析路径统一使用 helper

`server/utils/commandParser.js` 和 `server/routes/commands.js` 不再直接调用 `matter(content)`，统一调用 `parseFrontmatter(content)`。这样 slash command 文件、命令列表和 include 解析共享相同安全边界。

替代方案：只修一个入口。拒绝原因：命令解析存在多个入口，局部修复会留下绕过路径。

### 3. CLI 路径修复只绑定 Claude SDK options

当 `CLAUDE_CLI_PATH` 存在时，把该路径写入 SDK 的 `pathToClaudeCodeExecutable`。该修复不改变 CLI 检测、登录、设置页展示等现有逻辑。通过新增的 `__mapCliOptionsToSDKForTest` 测试导出，行为测试可以直接构造 options 并断言其他字段（cwd / permissionMode / model / resume / systemPrompt / settingSources / allowedTools）未被破坏。

### 4. 验收一律以行为级方式实施

二进制下载以**字节不变**为验收标准（临时 Express 实例 + `sendDownload` + `fetch` + `Buffer.equals`）。Service Worker 缓存以**新版本激活后清理旧 cache，fetch handler 不再 respondWith** 为验收标准（沙盒化 `self` + `caches` 中执行 `public/sw.js`）。Codex permission 与 workflow 自动运行权限通过直接调用 `__mapPermissionModeToCodexOptionsForTest`、`__buildCodexExecArgsForTest`、`resolveWorkflowAutoRunPermissionMode` 来验证。

替代方案：保留源码 regex 匹配。拒绝原因：regex 在没有任何行为修复的情况下也会通过，无法证明实现正确。

### 5. SDK 升级不在本变更范围内

不变更 `package.json` / `pnpm-lock.yaml` 中 `@openai/codex-sdk` 与 `@anthropic-ai/claude-agent-sdk` 的版本号。SDK 升级会牵涉到事件字段、权限参数、流式语义等多个回归点，需要在独立变更中以专门测试矩阵评估。本变更只把既有 permission / 自动运行语义固化为行为级测试，使下一个 SDK 升级变更必须通过这些测试才能合入。

## Risks / Trade-offs

- [frontmatter 行为收紧] -> 使用 `---json` frontmatter 的自定义命令会不再解析 metadata。该风险可接受，因为命令 metadata 应使用 YAML。
- [Service Worker 回归] -> 缓存策略容易影响离线体验。本变更已通过沙盒化执行行为测试覆盖关键更新语义；手工 QA 仍需验证刷新和安装路径在多浏览器下的行为。
- [二进制下载路径分散] -> 当前下载逻辑分布在 `server/project-file-operations.js`、`src/utils/api.js`、`src/components/file-tree/hooks/useFileTreeOperations.ts`。验收测试已从公共接口（HTTP 字节比对 + 前端 hook 行为约束）覆盖；后续若引入新下载入口，应同时扩展该 spec。
- [SDK 升级被推迟] -> 本变更不实施 SDK 升级。后续 SDK 升级变更必须通过本变更产出的行为级测试，不得通过修改测试来降低验收标准。

## Migration Plan

1. 增加 `parseFrontmatter` helper 和对应行为测试。
2. 将命令解析入口改为 helper，确认 YAML metadata 仍正常解析。
3. 补齐 `CLAUDE_CLI_PATH` 传递，增加 SDK options 行为测试。
4. 暴露 Codex permission / workflow 自动运行的测试导出，把现有语义固化为行为测试。
5. 增加二进制下载字节级行为测试与前端下载流程契约测试。
6. 增加沙盒化 Service Worker 行为测试。
7. 运行本变更 `test_cmd.sh` 和必要的现有回归测试。

## Open Questions

- 后续 SDK 升级变更应从 Codex SDK 还是 Claude Agent SDK 入手，要看哪一个上游变化更小、对本仓库回归压力更低。

## ADDED Requirements

### Requirement: 命令 frontmatter 解析必须禁用可执行 engine

系统 MUST 继续支持 YAML frontmatter，同时 MUST 禁用 `gray-matter` 的 `js`、`javascript`、`json` frontmatter engine，避免从项目或命令目录读取 markdown 时执行或解析不可信代码。

#### Scenario: YAML command metadata remains supported

- **WHEN** 系统解析包含 YAML frontmatter 的 slash command markdown
- **THEN** 系统 MUST 返回 frontmatter metadata
- **AND** 系统 MUST 保留正文 content

#### Scenario: JavaScript frontmatter is not executed

- **WHEN** 系统解析包含 `---js` 或 `---javascript` frontmatter 的 command markdown
- **THEN** 系统 MUST NOT 执行 frontmatter 中的 JavaScript（验收测试通过断言 `globalThis` 上的副作用未发生来证明）
- **AND** 系统 MUST NOT 将 JavaScript 导出的值作为可信 metadata
- **AND** 系统 MUST 保留 markdown 正文

#### Scenario: JSON frontmatter is not parsed through executable engine

- **WHEN** 系统解析包含 `---json` frontmatter 的 command markdown
- **THEN** 系统 MUST NOT 使用 `gray-matter` JSON engine 解析 metadata
- **AND** 系统 MUST 将该 metadata 视为空对象
- **AND** 系统 MUST 保留 markdown 正文

### Requirement: Claude SDK 必须尊重自定义 CLI 路径

系统 MUST 在 `CLAUDE_CLI_PATH` 存在时把该路径传入 Claude Agent SDK 的 `pathToClaudeCodeExecutable` option，使自定义 Claude CLI 安装位置在 SDK 模式下生效。

#### Scenario: CLAUDE_CLI_PATH is forwarded to SDK options

- **WHEN** 进程环境变量 `CLAUDE_CLI_PATH` 指向自定义 Claude CLI 可执行文件
- **AND** 系统通过 `mapCliOptionsToSDK` 构造 Claude Agent SDK query options
- **THEN** 返回值 MUST 在 `pathToClaudeCodeExecutable` 字段上携带该路径
- **AND** 同一返回值 MUST 不破坏 `cwd`、`permissionMode`、`model`、`resume`、`systemPrompt`、`settingSources`、`allowedTools` 现有字段
- **AND** 当 `CLAUDE_CLI_PATH` 缺失时 `pathToClaudeCodeExecutable` MUST 保持 undefined

> 验收方式：通过 `__mapCliOptionsToSDKForTest` 在测试中构造 options 并直接断言上述字段，而非匹配源码字符串。

### Requirement: Codex 与 workflow 自动运行的 permission 语义必须保持稳定

系统 MUST 在不引入 SDK 升级的前提下，锁定 `default | acceptEdits | bypassPermissions` 三种 Codex permission mode 与运行时 `(sandboxMode, approvalPolicy)` 的映射，并锁定后端托管 workflow 自动运行默认权限。

#### Scenario: Codex permission modes still map to expected runtime options

- **WHEN** 用户选择 `default`、`acceptEdits` 或 `bypassPermissions` Codex permission mode
- **THEN** `mapPermissionModeToCodexOptions` MUST 分别返回：
  - `default` → `{ sandboxMode: 'workspace-write', approvalPolicy: 'untrusted' }`
  - `acceptEdits` → `{ sandboxMode: 'workspace-write', approvalPolicy: 'never' }`
  - `bypassPermissions` → `{ sandboxMode: 'danger-full-access', approvalPolicy: 'never' }`
- **AND** 未知 permission mode MUST 退化为 `default` 语义
- **AND** 通过 `buildCodexExecArgs` 生成的 CLI 参数 MUST 包含 `--sandbox <mode>` 与 `approval_policy=<policy>` 覆盖

#### Scenario: Existing workflow auto-run permission mode remains stable

- **WHEN** workflow 自动运行器启动后端托管的 Codex 或 Claude 会话
- **THEN** `resolveWorkflowAutoRunPermissionMode` MUST 在未设置 env 时返回 `bypassPermissions`
- **AND** MUST 在 `CCFLOW_WORKFLOW_AUTORUN_PERMISSION` 设置时返回该值（让运维仍可自定义）

> 本变更显式不承诺 `@openai/codex-sdk` 或 `@anthropic-ai/claude-agent-sdk` 的版本升级。SDK 升级评估属于后续独立变更；本变更只锁定现有 permission 与自动运行语义不被回归破坏。

### Requirement: 二进制下载必须保持字节不变

系统 MUST 在文件树或编辑器下载二进制文件时保持原始字节完全一致，不得经过 UTF-8 字符串转换导致损坏。

#### Scenario: Server download endpoint preserves exact bytes

- **WHEN** 客户端通过文件下载接口（`sendDownload`）请求一个含 null byte、高位字节与 ASCII 混合的文件
- **THEN** 客户端收到的字节序列 MUST 与源文件字节完全一致
- **AND** 响应 body MUST 通过 `arrayBuffer()` / `blob()` 还原为原始 Buffer 时与源文件 `Buffer.equals()` 为 true

#### Scenario: Frontend download flow does not transcode the response

- **WHEN** 前端 `useFileTreeOperations.ts` 的 `downloadEntry` 处理下载响应
- **THEN** 该流程 MUST 调用 `response.blob()`
- **AND** 该流程 MUST NOT 调用 `response.text()`，以避免 UTF-8 转码破坏二进制内容

### Requirement: Service Worker 更新不得固定旧前端资源

系统 MUST 避免旧 Service Worker 持续缓存旧 HTML 或旧 hashed assets，前端新版本发布后用户刷新应获得最新资源。

#### Scenario: Service worker activation clears legacy caches

- **WHEN** 在沙盒化的 `self` + `caches` 环境中加载并激活 `public/sw.js`
- **THEN** activate 处理器 MUST 调用 `caches.keys()` 并对返回的每个 cache name 调用 `caches.delete(name)`
- **AND** MUST 调用 `self.registration.unregister()` 与 `self.clients.claim()`

#### Scenario: Service worker fetch handler does not respond with cached assets

- **WHEN** 在同一沙盒中模拟一次 navigate fetch 事件
- **THEN** fetch 处理器 MUST 不调用 `event.respondWith(...)`，确保浏览器走网络获取最新 HTML / 静态资源

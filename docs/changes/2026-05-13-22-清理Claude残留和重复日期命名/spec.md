### 需求：生产代码不得保留 Claude SDK 兼容层

系统必须彻底删除已退休的 Claude SDK provider 模块，不再通过 unsupported compatibility module 维持导入边界。

#### 场景：源码中不存在 Claude SDK 模块

- **当** 开发者检查 `server/` 生产源码
- **则** 不得存在 `server/claude-sdk.js`
- **且** 不得存在生产代码导入 `claude-sdk.js`

#### 场景：legacy Claude 输入仍被拒绝

- **当** 客户端尝试创建 `provider = "claude"` 的手动会话
- **则** 后端必须返回不支持的 provider 错误
- **且** 不得调用任何 Claude SDK 或兼容模块

### 需求：前端通用处理中状态不得使用 Claude 命名

聊天处理中状态必须使用 provider-neutral 命名。

#### 场景：发送 Codex 消息时显示通用处理中状态

- **当** 用户向 Codex 会话发送消息
- **则** 前端必须展示处理中状态和停止入口
- **且** 相关组件、state 和 prop 名称不得使用 `ClaudeStatus` 或 `claudeStatus`

#### 场景：发送 OpenCode 消息时显示通用处理中状态

- **当** 用户向 OpenCode 会话发送消息
- **则** 前端必须展示同一套通用处理中状态
- **且** 不得出现 Claude 作为 fallback 文案

### 需求：模型常量只暴露当前支持 provider

共享模型常量必须只描述当前仍支持的 provider。

#### 场景：模型常量不再导出 Claude provider

- **当** TypeScript 或 Node 测试导入共享模型常量
- **则** 只能获得 Codex 相关模型和 reasoning 常量
- **且** 不得存在 `CLAUDE_MODELS`

### 需求：重复日期前缀必须去重

仓库中的提案归档目录和测试文件不得重复包含日期前缀。

#### 场景：测试文件命名没有重复日期

- **当** 开发者列出根 `tests/` 文件
- **则** 不得存在 `YYYY-MM-DD-YYYY-MM-DD-*` 文件名
- **且** Playwright 配置必须引用去重后的文件名

#### 场景：归档提案目录命名没有重复日期

- **当** 开发者列出 `docs/changes/archive/`
- **则** 不得存在 `YYYY-MM-DD-YYYY-MM-DD-*` 目录名
- **且** 仓库文档中不得引用旧目录名

### 需求：当前支持面文案必须准确

用户可见文档不得把 Claude 描述为当前聊天 provider。

#### 场景：README 描述当前架构

- **当** 用户阅读 README
- **则** README 必须描述 ccflow 作为轻薄 Web 外壳
- **且** 当前聊天 provider 只能描述为 Codex/OpenCode 经 co 驱动
- **且** 工作流执行描述为 wo 驱动

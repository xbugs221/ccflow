### 需求：前端不得再暴露 OpenCode 入口

OpenCode 不再是支持的聊天 Provider。用户不应在正常 UI 中看到可启动或配置 OpenCode 的入口。

#### 场景：新建会话入口只显示 Codex 和 Pi

- **给定** 用户打开一个项目主页
- **当** 用户点击新建会话入口
- **则** Provider 选择中不得出现 OpenCode
- **且** 不得存在 `project-new-session-provider-opencode` 测试标识
- **并且** Codex 和 Pi 入口仍可见

#### 场景：设置页不显示 OpenCode Agent

- **给定** 用户打开设置页的 Agent 面板
- **当** Agent 列表渲染完成
- **则** 列表不得出现 OpenCode
- **且** 前端不得请求 `/api/cli/opencode/status`
- **并且** Codex 和 Pi 状态仍按原有方式显示

### 需求：后端不得再提供 OpenCode 运行时接口

OpenCode 的 REST、WebSocket、shell 和 co request 路径都必须被删除，不保留专门兼容分支。

#### 场景：OpenCode REST 路由不再注册

- **给定** 服务端启动
- **当** 客户端请求 `/api/cli/opencode/status`
- **则** 服务端不得进入 OpenCode 专属路由处理
- **且** 仓库运行时代码不得继续依赖 `server/routes/opencode.ts`
- **并且** `server/routes/opencode.ts` 和 `server/opencode-sdk.ts` 不再作为运行时源码存在

#### 场景：WebSocket 不接受 opencode-command

- **给定** 旧客户端向聊天 WebSocket 发送 `opencode-command`
- **当** 服务端处理该消息
- **则** 服务端不得写入 `provider: "opencode"` 的 co request
- **且** 不得返回 OpenCode 专属 success/complete 消息
- **并且** 服务端源码不得包含 `opencode-command` 分支

#### 场景：co request provider 白名单不包含 OpenCode

- **给定** 代码调用 `buildCoRequest()` 并传入 `provider: "opencode"`
- **当** 请求被校验
- **则** 校验必须失败
- **且** 错误信息应只列出当前支持的 Codex/Pi provider

### 需求：项目发现不再读取或返回 OpenCode 会话

项目概览应只聚合当前支持的 Provider，不再访问 OpenCode CLI 或 SQLite。

#### 场景：项目 payload 不包含 opencodeSessions

- **给定** 用户请求 `/api/projects`
- **当** 服务端返回项目列表
- **则** 每个项目不应包含 `opencodeSessions`
- **且** `codexSessions` 与 `piSessions` 仍保持可用

#### 场景：项目发现不读取 OpenCode 数据源

- **给定** 环境变量中存在 `OPENCODE_DB_PATH`
- **且** 本机可能存在 OpenCode SQLite 或 CLI
- **当** 服务端刷新项目列表
- **则** 项目发现不得读取 OpenCode DB
- **且** 不得执行 `opencode session list`

### 需求：运行时代码不得保留 OpenCode 历史兼容路径

删除 OpenCode 支持后，不为旧配置、旧会话或旧工作流保留只读展示、隐藏兼容或 fallback。

#### 场景：项目状态不再读取 OpenCode 字段

- **给定** 执行阶段清理项目 read model
- **当** 运行源码契约检查
- **则** `src/` 和 `server/` 的运行时路径不得继续通过 `opencodeSessions` 推断 Provider
- **且** 不得保留 `provider === "opencode"` 的兼容分支

#### 场景：工作流不再识别 OpenCode 角色

- **给定** 执行阶段清理工作流 read model 和 UI
- **当** 运行源码契约检查
- **则** 当前运行时代码不得保留 `opencode:role`、`opencode:executor` 或 `opencode:planner` 的识别逻辑
- **且** 不得为 OpenCode 历史子会话提供只读兼容展示
 
### 需求：测试契约必须阻止 OpenCode 支持回流

删除 OpenCode 支持后，测试应覆盖“不存在”的关键行为，而不是继续维护旧正向集成测试或伪造旧 OpenCode 数据。

#### 场景：OpenCode 正向测试被删除或改写

- **给定** 执行阶段清理测试
- **当** 运行项目测试套件
- **则** 不应再有测试要求 `AGENT_PROVIDERS` 包含 OpenCode
- **且** 不应再有测试要求 `server/opencode-sdk.ts` 或 `/api/cli/opencode` 存在

#### 场景：不再伪造 OpenCode 兼容测试夹具

- **给定** 执行阶段新增反向契约测试
- **当** 编写测试数据
- **则** 不得构造旧 OpenCode 项目、旧 OpenCode 工作流或旧 OpenCode 会话 fixture
- **且** 测试应基于真实源码、真实接口、真实页面和真实文档断言 OpenCode 不存在

#### 场景：反向契约覆盖 UI 和后端

- **给定** 执行阶段新增反向契约测试
- **当** OpenCode 入口、路由或 co provider 白名单被意外恢复
- **则** 对应测试必须失败

### 需求：运行时文档必须同步移除 OpenCode 支持声明

文档不能继续告诉用户系统支持 OpenCode。

#### 场景：README 和测试说明不再声明 OpenCode 支持

- **给定** 执行阶段更新文档
- **当** 检查 README、测试说明和当前活动文档
- **则** 不得继续出现 Codex/OpenCode 会话支持说明
- **且** Provider 表述应改为 Codex/Pi 或通用 Agent

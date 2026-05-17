### 需求：`pnpm test` 必须成为全量验收入口

仓库应提供一个覆盖全部关键质量门禁的 `pnpm test` 命令。

#### 场景：全量测试入口覆盖所有现有测试层

- **当** 开发者运行 `pnpm test`
- **则** 必须执行 `pnpm run typecheck`
- **且** 必须执行 `pnpm run test:server`
- **且** 必须执行 `pnpm run test:spec`
- **且** 必须执行 `pnpm run test:e2e`

#### 场景：browser spec 不得被排除在全量入口之外

- **当** `pnpm test` 执行 `pnpm run test:spec`
- **则** `test:spec` 必须继续包含 `test:spec:browser`
- **且** browser spec 失败必须导致 `pnpm test` 失败

#### 场景：最终验收必须全绿

- **当** 本变更完成后运行 `pnpm test`
- **则** 命令必须以 0 退出
- **且** 不得存在为了通过而新增的无条件 skip 或条件跳过

### 需求：测试和文档必须适配当前 TypeScript 代码库

测试不得继续断言已删除的 JS/JSX 文件。

#### 场景：静态契约读取当前 TS/TSX 文件

- **当** 测试检查前端入口、认证组件、项目创建向导或语言选择器
- **则** 必须读取当前 `.ts` 或 `.tsx` 文件
- **且** 不得读取 `src/main.jsx`、`SetupForm.jsx`、`Onboarding.jsx`、`ProjectCreationWizard.jsx` 或 `LanguageSelector.jsx`

#### 场景：服务端导入断言不得违背当前构建策略

- **当** 测试检查服务端源码导入 shared 模块
- **则** 应以 `pnpm run typecheck`、`pnpm run build` 和运行级导入测试证明入口有效
- **且** 不得仅凭源码 import specifier 是否包含 `.ts` 判定失败

#### 场景：归档文档不再引用旧测试路径

- **当** 扫描 `docs/changes/archive`
- **则** 不得继续引用已删除或重命名后的旧重复测试路径
- **且** 仍需保留必要的历史设计说明，但路径必须指向当前 canonical 测试或说明已归并

### 需求：历史重复测试必须归并到 canonical 测试

每个业务契约应有清晰的测试归属，避免旧 proposal 副本与当前测试互相冲突。

#### 场景：重复的 server 契约测试被归并

- **当** 根目录 proposal 测试与 `tests/server` 中的测试覆盖同一业务契约
- **则** 应保留 `tests/server` 中的 canonical 测试
- **且** 旧 proposal 测试中的独有断言必须迁入 canonical 测试后再删除旧副本

#### 场景：重复的 spec 契约测试被归并

- **当** 根目录 proposal 测试与 `tests/spec` 中的测试覆盖同一浏览器或静态契约
- **则** 应保留 `tests/spec` 或明确命名的 canonical 测试
- **且** Playwright 配置不得继续引用被删除的旧路径

#### 场景：当前行为优先于旧 proposal 预期

- **当** 旧测试与 29、30、31 或后续近期变更的实现意图冲突
- **则** 应更新或删除旧测试
- **且** 不得为了旧测试恢复已被近期提案废弃的行为

### 需求：测试运行态路径必须使用 XDG state helper

测试应跟随当前 wo/cbw 运行态路径策略。

#### 场景：wo state 读写使用当前运行态根目录

- **当** 测试需要读写 wo `state.json`
- **则** 必须通过 `resolveWoRunsRoot`、`resolveWoRunStatePath` 或 fixture helper 解析路径
- **且** 不得把项目内 `.wo/runs/<run>/state.json` 当作当前真实运行态

#### 场景：cbw 项目配置使用当前 state config

- **当** 测试需要验证项目会话 UI 状态、收藏、待处理或隐藏配置
- **则** 必须读取当前项目 state config
- **且** 不得只检查旧项目内 `.cbw/conf.json`

#### 场景：展示用 artifact path 与真实 state path 区分

- **当** wo state 中包含 `.wo/runs/.../logs/...` 这类展示路径
- **则** 测试可以断言其作为 artifact 文本或相对路径显示
- **但** 不得把该展示路径误用为测试夹具的真实 state 读写位置

### 需求：Playwright 业务测试必须覆盖当前用户流程

浏览器测试应通过真实用户流程验证当前产品行为。

#### 场景：Pi 手动会话可创建并发送消息

- **当** 用户在项目主页选择 Pi provider 新建手动会话
- **则** 页面应进入稳定的 `cN` 会话路由
- **且** 项目 payload 应包含对应 `piSessions`
- **且** 发送消息时 WebSocket 应发出 `pi-command`，并携带 Pi provider 语义

#### 场景：co 会话重连保持会话身份

- **当** 用户在运行中的 Codex 或 OpenCode 会话中刷新页面或打开第二个窗口
- **则** 会话应继续使用同一个 cN 路由和 provider conversation
- **且** 不得重复提交首条请求或把 abort 发给错误 turn

#### 场景：Shell websocket 断线后可恢复

- **当** Shell 面板已建立 `/shell` websocket 后意外断开
- **则** 前端应重新建立 shell websocket
- **且** 终端表面仍可见并能继续输入

#### 场景：工作流 role row 点击目标明确

- **当** 工作流详情同时展示会话按钮和文档/产物按钮
- **则** 点击会话入口的测试必须明确选择 `会话` 按钮
- **且** 点击文档/产物入口的测试必须单独断言其打开对应文件或目录

#### 场景：OpenCode 设置页展示当前 provider 状态

- **当** fake OpenCode CLI 返回 provider、空 provider 或读取失败
- **则** 设置页必须展示当前业务文案和错误信息
- **且** 不得沿用已经废弃的旧文案作为验收标准

#### 场景：项目主页状态操作持久化到当前配置

- **当** 用户在项目主页右键收藏、标记待处理、隐藏或恢复会话/工作流
- **则** UI 应立即反映状态
- **且** 当前 state config 中应持久化对应状态

### 需求：清理后不得残留旧失败基线

本变更完成后，31 号提案中记录的 browser spec 失败不得继续作为豁免。

#### 场景：旧失败清单被消除

- **当** 开发者运行 browser spec 和 e2e
- **则** 31 号提案中记录的 selector、fixture 路径、UI 文案和时序失败应全部消除
- **且** 若有新失败，必须作为本变更阻塞问题处理

#### 场景：文档说明当前测试策略

- **当** 审阅者查看本变更文档
- **则** 应能看到哪些测试被删除、归并、更新或修复
- **且** 能通过 `pnpm test` 复现最终验收结果

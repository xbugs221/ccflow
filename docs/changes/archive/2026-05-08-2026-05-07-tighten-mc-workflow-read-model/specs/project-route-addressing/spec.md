## 新增需求

### 需求：Workflow 路由必须完全基于 runId

系统必须为 Go-backed workflow 使用 `runId` 路由，不得要求 workflow `routeIndex` 或 `wN`。

#### 场景：workflow 详情路由使用 runId
- **当** 用户点击 workflow 列表中的 run
- **则** 地址栏显示 `/<project>/runs/<runId>`
- **且** `runId` 来自 `.ccflow/runs/<runId>/state.json` 或 run 目录名
- **且** URL 不包含 `wN`

#### 场景：旧 wN route 不作为主路径
- **当** 测试、链接或旧代码尝试生成 `/wN`
- **则** 新代码不得继续依赖该路径
- **且** 如需兼容旧 URL，只能重定向到 `/runs/<runId>`，不能重新引入 workflow routeIndex store

### 需求：Workflow child session 路由必须能区分 stage、role 和 session id

系统必须为 runner-owned child session 提供不冲突的 route address。

#### 场景：stage child route
- **当** execution stage 只有一个 child session
- **则** 地址为 `/<project>/runs/<runId>/sessions/execution`

#### 场景：stage role child route
- **当** review stage 同时存在 reviewer 和 executor session
- **则** 地址分别包含 role
- **且** 点击对应 process row 时进入对应 role session

#### 场景：by-id fallback route
- **当** 同一个 stage/role 有多个 session
- **则** 地址使用 `/<project>/runs/<runId>/sessions/by-id/<sessionId>`
- **且** 页面刷新后必须恢复同一 session

### 需求：手动会话路由继续使用 cN 且不混入 workflow session

系统必须保留手动会话的 `cN` route，但 workflow-owned sessions 不得出现在项目级 `cN` 导航中。

#### 场景：手动会话使用 cN
- **当** 用户创建或打开普通手动会话
- **则** 地址为 `/<project>/cN`
- **且** `cN` 由 ccflow 手动会话配置维护

#### 场景：workflow session 不解析为 cN
- **当** runner state 包含某 Codex session
- **则** 该 session 只能通过 `/runs/<runId>/sessions/...` 打开
- **且** 项目级 `/cN` 不得解析为该 workflow-owned session


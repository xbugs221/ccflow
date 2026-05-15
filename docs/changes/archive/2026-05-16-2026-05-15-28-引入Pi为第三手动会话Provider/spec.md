### 需求：手动会话必须支持 Pi provider

系统必须把 Pi 作为 Codex、OpenCode 之外的第三种手动会话 provider。

#### 场景：用户从项目概览创建 Pi 会话

- **当** 用户在项目概览点击新建会话
- **则** provider 选择器必须显示 `Codex`、`OpenCode` 和 `Pi`
- **当** 用户选择 `Pi`
- **则** 后端必须创建 `provider = "pi"` 的手动会话草稿
- **且** 项目 read model 必须把该会话放入 `piSessions`

#### 场景：用户在空聊天页选择 Pi

- **当** 当前没有已选会话
- **则** 聊天空状态必须允许用户选择 `Pi`
- **且** 选择 Pi 后不得显示 Codex 专属模型和思考深度控件
- **且** 后续发送消息必须使用 Pi provider

#### 场景：未知 provider 仍被拒绝

- **当** 客户端请求创建 `provider = "claude"` 或其他未知 provider 的手动会话
- **则** 后端必须返回不支持 provider 的错误
- **且** 不得创建草稿、写 co request 或 fallback 到其他 provider

### 需求：Pi 聊天必须通过 co 文件协议提交

ccflow 不得直接管理 Pi CLI 聊天进程，所有 Pi turn 必须通过 `co-request-v1`。

#### 场景：Pi provider 可用时发送消息

- **给定** `co doctor --json` 返回 `ok = true`、`contract = "co-request-v1"` 且 `providers.pi` 可用
- **当** 用户在 Pi 会话中发送消息
- **则** ccflow 必须向 `requests/pending/` 原子写入一个 request 文件
- **且** request 必须包含 `provider = "pi"`、稳定 `conversation_id`、`project_path` 和用户文本
- **且** ccflow 不得直接 spawn `pi`

#### 场景：Pi provider 不可用时阻止发送

- **给定** `co doctor --json` 未报告 `providers.pi` 可用
- **当** 用户尝试创建 Pi 草稿或发送 Pi 消息
- **则** 后端必须返回明确错误
- **且** 不得创建手动会话草稿
- **且** 不得写入 pending request

#### 场景：Pi 终止请求通过 co abort

- **给定** Pi 会话存在 active turn
- **当** 用户点击停止
- **则** ccflow 必须写入 `op = "abort"` 的 co request
- **且** request 必须包含 `provider = "pi"`、`conversation_id` 和当前 `target_turn_id`
- **且** 终止逻辑不得依赖 ccflow 内存中的 Pi 进程句柄

### 需求：Pi realtime 事件必须进入正确会话

Pi 的 co events 必须像 Codex/OpenCode 一样由稳定 `cN` route 过滤和展示。

#### 场景：Pi response 追加到当前会话

- **给定** co 写入 `pi-response` 事件
- **且** 事件包含 `conversation_id = "c28"`
- **当** 浏览器正在查看 `c28`
- **则** 前端必须把 assistant 内容追加到当前 Pi 会话
- **且** 不得因为 provider session id 与 route id 不同而丢弃事件

#### 场景：Pi complete 清理 processing 状态

- **当** 浏览器收到 `pi-complete`
- **则** 对应 `cN` 会话必须退出 processing 状态
- **且** 后续同页发送消息仍能继续使用同一个 `conversation_id`

#### 场景：Pi error 显示明确错误

- **当** 浏览器收到 `pi-error`
- **则** 当前会话必须显示 provider 错误
- **且** 不得把错误误归类为 Codex 或 OpenCode

### 需求：项目和工作流 read model 必须识别 Pi

项目会话列表和工作流只读视图必须能稳定识别 Pi 会话。

#### 场景：项目 read model 返回 Pi 会话

- **给定** 项目中存在 Pi 手动会话
- **当** 前端加载项目列表
- **则** 项目 payload 必须包含 `piSessions`
- **且** 侧边栏、项目概览和会话导航必须能从 `piSessions` 推断 provider 为 `pi`

#### 场景：workflow 中的 pi 前缀匹配真实会话

- **给定** wo state 中存在 `pi:executor`
- **且** 项目 read model 中存在对应 Pi 会话
- **当** 前端渲染工作流角色摘要
- **则** `pi:executor` 必须生成可点击的会话链接
- **且** 链接必须打开对应 Pi 会话

#### 场景：workflow 中的 pi 前缀无匹配会话

- **给定** wo state 中存在 `pi:executor`
- **但** 项目 read model 中没有对应 Pi 会话
- **当** 前端渲染工作流角色摘要
- **则** 该 sessionRef 必须保持 unlinked
- **且** 不得生成坏链接

### 需求：设置页必须只展示 Pi 基础可用性

在没有稳定 Pi 认证 JSON 契约前，设置页不得声称能完整判断 Pi 账号状态。

#### 场景：服务进程能找到 Pi CLI

- **给定** 服务进程 `PATH` 中存在可执行 `pi`
- **当** 用户打开设置页智能体面板
- **则** Pi 面板必须显示 CLI 可用
- **且** 可以显示 command path 或 version 等非敏感信息
- **但** 不得显示完整 API key、token 或 secret

#### 场景：服务进程找不到 Pi CLI

- **给定** 服务进程 `PATH` 中不存在可执行 `pi`
- **当** 用户打开设置页智能体面板
- **则** Pi 面板必须显示不可用
- **且** 错误必须提示需要安装 Pi、暴露到服务进程 PATH 或配置明确路径

#### 场景：Pi CLI 可用但 co provider gate 不可用

- **给定** `pi` CLI 可执行
- **但** `co doctor --json` 未报告 `providers.pi` 可用
- **当** 用户尝试发送 Pi 消息
- **则** 发送必须失败并提示 co provider gate 不可用
- **且** 不得因为 Pi CLI 可执行而绕过 co gate

## 新增需求

### 需求：OpenCode 状态不得因 auth list JSON 不兼容误报断开

设置页必须基于 OpenCode CLI 实际可用性和认证列表展示状态，不得因为 `opencode auth list --json` 不兼容就显示 `已断开`。

#### 场景：OpenCode 不支持 auth list JSON 但文本列表可用

- **当** 服务端执行 `opencode auth list --json` 失败
- **且** 服务端执行 `opencode auth list` 成功
- **且** 文本输出包含已绑定 provider
- **当** 用户打开 `设置 > 智能体 > OpenCode`
- **则** 页面必须显示 OpenCode 可用
- **且** 页面不得显示 `已断开`
- **且** 页面必须展示已绑定 provider 列表

#### 场景：OpenCode CLI 可用但 provider 列表读取失败

- **当** OpenCode CLI 可执行
- **但** provider 列表读取失败
- **当** 用户打开 `设置 > 智能体 > OpenCode`
- **则** 页面必须显示 OpenCode 可用
- **且** 页面必须显示 provider 状态读取失败的错误摘要
- **且** 页面不得把 CLI 可用状态显示成 `已断开`

### 需求：设置页必须展示 OpenCode 内部绑定 provider

OpenCode 内部已经绑定 provider 时，设置页必须展示 provider 名称。

#### 场景：OpenCode 已绑定多个 provider

- **当** OpenCode 认证列表返回 `DeepSeek`
- **且** OpenCode 认证列表返回 `Kimi For Coding`
- **当** 用户打开 `设置 > 智能体 > OpenCode`
- **则** 页面必须展示 `DeepSeek`
- **且** 页面必须展示 `Kimi For Coding`
- **且** OpenCode 侧边列表项必须显示可用或已连接状态

#### 场景：OpenCode 可用但尚未绑定 provider

- **当** OpenCode CLI 可执行
- **但** OpenCode 认证列表中没有 provider
- **当** 用户打开 `设置 > 智能体 > OpenCode`
- **则** 页面必须显示 `OpenCode 可用，尚未绑定 provider`
- **且** 页面不得假装已经绑定 provider
- **且** 页面不得显示 `已断开`

### 需求：设置页必须展示非敏感 API 信息

设置页必须展示 OpenCode 内部 provider 的非敏感 API 信息，并且不得泄露完整密钥。

#### 场景：provider 使用 API 认证

- **当** OpenCode 认证列表显示 `DeepSeek api`
- **且** OpenCode 认证列表显示 `Kimi For Coding api`
- **当** 用户打开 `设置 > 智能体 > OpenCode`
- **则** `DeepSeek` 行必须展示 `API` 认证类型
- **且** `Kimi For Coding` 行必须展示 `API` 认证类型
- **且** 页面可以展示 credential 来源或 base URL 摘要
- **但** 页面不得展示完整 API key、token 或 secret

### 需求：OpenCode 状态接口必须返回结构化 provider 和 API 元数据

后端状态接口必须把 OpenCode 认证列表标准化为前端可展示的结构。

#### 场景：解析文本认证列表

- **当** `opencode auth list` 输出包含 `DeepSeek api`
- **且** 输出包含 `Kimi For Coding api`
- **当** 客户端请求 `/api/cli/opencode/status`
- **则** 响应必须包含 `providers[0].name = DeepSeek`
- **且** 响应必须包含某个 provider 的 `name = Kimi For Coding`
- **且** 对应 provider 的 `authType` 或 `api.type` 必须为 `api`
- **且** 响应必须包含 `available = true`
- **且** 响应必须包含 `authenticated = true`

#### 场景：OpenCode CLI 不存在

- **当** 服务进程 PATH 中不存在 OpenCode CLI
- **当** 客户端请求 `/api/cli/opencode/status`
- **则** 响应必须说明 OpenCode CLI 不可用
- **且** 响应不得返回已连接 provider
- **且** 错误信息必须包含可用于排查 PATH 的摘要

### 需求：必须用端到端测试覆盖设置页展示路径

本变更必须有端到端测试证明浏览器能通过真实后端和服务进程 PATH 看到 OpenCode 内部 provider 与 API 信息。

#### 场景：浏览器通过真实后端看到 provider 和 API 信息

- **当** 测试服务进程 PATH 中存在 fake `opencode`
- **且** fake `opencode auth list` 输出 `DeepSeek api` 和 `Kimi For Coding api`
- **且** 测试不 mock `/api/cli/opencode/status`
- **当** 用户在浏览器打开设置页
- **并且** 用户进入 `智能体 > OpenCode`
- **则** 页面必须显示 `DeepSeek`
- **且** 页面必须显示 `Kimi For Coding`
- **且** 页面必须显示 `API`
- **且** 页面不得显示 `已断开`

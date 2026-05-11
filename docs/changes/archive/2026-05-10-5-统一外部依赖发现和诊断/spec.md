## 新增需求

### 需求：ccflow 必须统一通过 PATH 发现外部运行依赖

系统必须用服务进程的 `PATH` 查找 `oz`、`wo` 和 `co`，并把实际命中的可执行路径暴露给诊断接口。

#### 场景：PATH 中存在 fake 依赖时诊断成功

- **当** 测试或部署环境只在 `PATH` 中提供 `oz`、`wo`、`co`
- **且** 仓库内没有写死这些命令的绝对路径
- **则** ccflow 必须发现这些命令
- **且** 诊断结果必须包含每个命令的 `command_path`
- **且** `command_path` 必须是 `PATH` 中实际命中的路径

#### 场景：依赖缺失时错误可操作

- **当** `PATH` 中找不到 `oz`、`wo` 或 `co`
- **则** ccflow 必须返回明确诊断
- **且** 诊断必须包含缺失命令名
- **且** 诊断必须包含当前服务进程 `PATH`
- **且** 不得把工具状态目录误当成可执行路径展示

### 需求：ccflow 必须分别校验 oz、wo、co 的能力契约

系统必须按工具自身职责校验能力，而不是只检查文件存在。

#### 场景：oz 通过版本检查

- **当** `oz` 能从 `PATH` 发现
- **且** `oz --version` 成功
- **则** `oz` 诊断必须标记为可用

#### 场景：wo 通过工作流 contract 检查

- **当** `wo` 能从 `PATH` 发现
- **且** `wo contract --json` 返回所需 workflow capabilities
- **则** `wo` 诊断必须标记为可用

#### 场景：co 通过聊天 doctor 检查

- **当** `co` 能从 `PATH` 发现
- **且** `co doctor --json` 返回 `ok: true`
- **且** `contract` 为 `co-request-v1`
- **则** `co` 诊断必须标记为可用
- **且** 诊断必须保留 co 返回的 `home` 作为运行目录

### 需求：co provider 可用性判断必须兼容 boolean 和 object schema

系统必须兼容已存在的 `co doctor --json` provider 输出格式。

#### 场景：provider 使用 boolean true

- **当** `co doctor --json` 返回 `providers.opencode: true`
- **则** ccflow 必须认为 OpenCode provider 可用
- **且** OpenCode 聊天发送不得被误拒绝为 `co provider "opencode" is unavailable`

#### 场景：provider 使用 available 字段

- **当** `co doctor --json` 返回 `providers.opencode.available: true`
- **则** ccflow 必须认为 OpenCode provider 可用

#### 场景：provider 明确不可用

- **当** `co doctor --json` 返回 `providers.opencode: false`
- **或** 返回 `providers.opencode.available: false`
- **则** ccflow 必须认为 OpenCode provider 不可用
- **且** 发送前必须返回明确错误
- **且** 不得写入 co request 文件

### 需求：聊天发送必须在依赖门禁通过后才落盘

系统必须先完成 `co` 可执行发现、doctor contract 校验和 provider 可用性校验，再写入 request 文件。

#### 场景：OpenCode provider 可用时完成真实发送路径

- **当** 浏览器选择 OpenCode 新会话
- **且** fake `co` 只通过 `PATH` 暴露
- **且** `co doctor --json` 返回 `providers.opencode: true`
- **当** 用户发送消息
- **则** ccflow 必须写入 `co-request-v1` request
- **且** fake co daemon 写出的 `opencode-response` 必须展示在页面中

#### 场景：OpenCode provider 不可用时不接受消息

- **当** 浏览器选择 OpenCode 新会话
- **且** `co doctor --json` 返回 OpenCode provider 不可用
- **当** 用户发送消息
- **则** 页面必须展示可理解的失败信息
- **且** 后端不得写入该消息对应的 pending request
- **且** 后端不得发送 `message-accepted`
- **且** 后端不得回退到 Node 侧 OpenCode runner

### 需求：诊断接口必须展示命令路径和运行目录的区别

系统必须避免把 `co home`、`.wo/runs` 或项目目录当作可执行路径。

#### 场景：查看运行依赖诊断

- **当** 用户打开运行依赖诊断接口
- **则** `co` 必须同时展示 `command_path` 和 `home`
- **且** `wo` 必须展示 `command_path` 和 contract capabilities
- **且** `oz` 必须展示 `command_path` 和 version 检查结果

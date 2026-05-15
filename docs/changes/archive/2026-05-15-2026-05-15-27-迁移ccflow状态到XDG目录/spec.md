### 需求：ccflow 项目级状态必须写入 XDG state 目录

系统必须把项目级 ccflow 自有配置写入用户 state 目录，而不是项目内 `.ccflow`。

#### 场景：新建手动会话不创建项目内 `.ccflow`

- **当** 用户在一个项目中创建新的手动 Codex 或 OpenCode 会话
- **则** 后端必须把 route、draft 和 provider 元数据写入 `${XDG_STATE_HOME:-~/.local/state}/ccflow/repos/<repo-key>/conf.json`
- **且** 不得创建 `<project>/.ccflow/conf.json`
- **且** 刷新项目列表后该会话仍显示为稳定的 `/cN` 路由

#### 场景：项目级 UI 状态写入 state config

- **当** 用户修改会话标题、模型设置或 favorite/hidden/pending 状态
- **则** 这些状态必须写入 state repo config
- **且** 后续刷新页面仍能恢复这些状态

### 需求：旧 `.ccflow` 配置必须兼容迁移

系统必须能读取已有项目内 `.ccflow/conf.json`，并把它迁移到新的 state 路径。

#### 场景：读取旧项目级配置后生成新配置

- **假设** `<project>/.ccflow/conf.json` 已存在且新 state config 不存在
- **当** 后端加载该项目配置
- **则** 必须读取旧配置内容
- **且** 必须在 state repo 目录写入规范化后的 `conf.json`
- **且** 手动会话 route、provider session 绑定和标题不得丢失

#### 场景：新旧配置同时存在时优先新配置

- **假设** state repo config 和 `<project>/.ccflow/conf.json` 同时存在
- **当** 后端加载项目配置
- **则** 必须以 state repo config 为准
- **且** 不得用旧配置覆盖新配置

### 需求：全局 ccflow 配置必须迁移到 state root

系统必须把全局项目列表和显示名等配置迁移到 state root。

#### 场景：读取旧全局配置

- **假设** `~/.ccflow/conf.json` 已存在且 state root `conf.json` 不存在
- **当** 后端加载全局配置
- **则** 必须迁移到 `${XDG_STATE_HOME:-~/.local/state}/ccflow/conf.json`
- **且** 手动添加项目和 display name 仍能出现在 `/api/projects`

### 需求：repo-key 必须避免同名项目冲突

系统必须为不同绝对路径的同名项目生成不同 state repo 目录。

#### 场景：两个同 basename 项目写入不同 config

- **当** 两个绝对路径不同但 basename 相同的项目分别创建手动会话
- **则** 两个项目必须写入不同的 `repos/<repo-key>/conf.json`
- **且** `/api/projects` 读取时不得互相混入会话 route 或标题

### 需求：迁移不得改变 co 和 wo 状态来源

系统迁移 `.ccflow` 时不得改变外部执行器状态协议。

#### 场景：co 和 wo 路径保持不变

- **当** 用户发送聊天消息或启动 workflow
- **则** `co` request/state/events 仍使用现有 `resolveCoHome` 路径
- **且** `wo` workflow read model 仍从 `${XDG_STATE_HOME:-~/.local/state}/wo/repos/.../state.json` 读取
- **且** ccflow 不得把 co/wo 状态写入新的 project config 文件

## Purpose

定义 WebUI 中快捷指令目录的来源、解析规则与刷新行为，便于后续在排查指令缺失、重名或刷新不及时问题时有统一依据。

## Requirements

### Requirement: 从内置 alias 与全局 alias 目录加载快捷指令
系统 SHALL 从仓库随包发布的内置 alias 目录和用户全局 `~/.config/ccflow-alias/` 目录加载快捷指令，不再聚合项目级命令目录。

#### Scenario: 命令列表包含内置 alias 和用户 alias
- **WHEN** 前端调用 `/api/commands/list`
- **THEN** 返回结果包含仓库内置 alias Markdown 指令文件
- **AND** 返回结果包含 `~/.config/ccflow-alias/` 下扫描得到的 Markdown 指令文件
- **AND** 每条命令标记来源 namespace，以便区分内置命令和用户命令

### Requirement: 递归扫描 Markdown 命令文件并派生命令名
系统 SHALL 递归扫描命令目录中的 `.md` 文件，并以相对于命令根目录的路径派生命令名。

#### Scenario: 子目录命令转换为斜杠路径
- **WHEN** 命令文件位于 `~/.config/ccflow-alias/foo/bar.md`
- **THEN** 该文件在命令列表中的名称为 `/foo/bar`

#### Scenario: 内置 OpenSpec 命令转换为斜杠路径
- **WHEN** 内置命令文件位于 `server/commands/aliases/propose.md`
- **THEN** 该文件在命令列表中的名称为 `/propose`

### Requirement: 从 frontmatter 或正文首行提取描述
系统 SHALL 优先使用命令文件 frontmatter 中的 `description` 作为说明文本；若未提供，则退回到正文第一行。

#### Scenario: 未配置 description 时使用正文首行
- **WHEN** 命令文件没有 frontmatter `description`
- **THEN** 命令列表中的 `description` 使用去掉 Markdown 标题标记后的正文第一行

### Requirement: 仅在显式重新拉取时刷新命令目录
系统 SHALL 仅在前端显式请求 `/api/commands/list` 时刷新斜杠命令目录，不对命令目录建立文件系统监听。

#### Scenario: 修改用户命令文件不会自动刷新菜单
- **WHEN** 用户直接修改 `~/.config/ccflow-alias/` 中的命令文件，且前端未重新请求 `/api/commands/list`
- **THEN** 当前打开的斜杠命令菜单不会自动反映该变更

#### Scenario: 切换项目后重新加载命令目录
- **WHEN** 前端初始化或项目发生变化并重新请求 `/api/commands/list`
- **THEN** 前端重新请求 `/api/commands/list`，并使用最新返回结果更新斜杠命令菜单

### Requirement: 执行自定义命令时按路径重新读取命令文件
系统 SHALL 在执行快捷指令时根据命令路径再次读取命令文件内容，而不是仅复用菜单加载时的缓存正文。

#### Scenario: 菜单未刷新但执行读取到最新正文
- **WHEN** 某个已存在的自定义命令文件正文被修改，但前端命令菜单尚未刷新
- **THEN** 后端在处理该命令的执行请求时仍按命令路径重新读取文件，并使用最新正文进行参数替换与执行准备

### Requirement: 命令执行只能读取受信任命令目录
系统 SHALL 只允许加载和执行内置 alias 目录或用户全局 alias 目录内的命令文件。

#### Scenario: 拒绝目录外命令路径
- **WHEN** 执行请求传入不属于内置 alias 目录或 `~/.config/ccflow-alias/` 的路径
- **THEN** 后端返回 access denied

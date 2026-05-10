## 设计原则

设置页只承载用户必须长期维护的偏好和状态。全局机器状态、历史外部 API 能力、低频工具配置不应挤在设置页里。

```text
保留条件
  |
  +-- 用户频繁查看或切换
  +-- 当前 ccflow 核心路径需要
  +-- 可通过 UI 明确解释结果

移除条件
  |
  +-- 写入用户全局环境
  +-- 当前产品路径不依赖
  +-- 已有更合适的专属入口
```

## 设置页收敛

顶层 tab 应从类型、常量、渲染和初始 tab 归一化逻辑同时收敛到：

```ts
type SettingsMainTab = 'appearance' | 'agents' | 'diagnostics';
```

旧入口处理规则：

- 外部调用传入 `git` 或 `api` 时，归一化到 `appearance`。
- 外部调用传入旧的 `tools` 或 `tasks` 时，继续归一化到 `agents`。
- UI 不再渲染 `Git`、`API 和令牌`。

设置页底部保存按钮仍可保留，用于深色模式、语言和未来设置保存状态；但不再保存项目排序、代码编辑器或全局 git identity。

## 外观页

`AppearanceSettingsTab` 只保留：

- 深色模式。
- 语言选择。

需要同步移除：

- `projectSortOrder` props 和设置持久化。
- `codeEditorSettings` props、localStorage 同步和 `codeEditorSettingsChanged` 事件触发。
- `appearanceSettings.projectSorting` 和 `appearanceSettings.codeEditor` 文案。

项目列表排序如果仍然存在业务需求，应由侧边栏自己的排序策略决定，不再从设置页暴露。

## Git 和 API 设置移除

Git 移除范围：

```text
src/components/settings/view/tabs/git-settings/
src/components/settings/hooks/useGitSettings.ts
server/routes/user.js:/git-config
server/utils/gitConfig.js
tests/docs that only verify global git config settings
```

必须保留：

```text
src/components/git-panel/
server/routes/git.js
tests/spec/git-panel-workflows.spec.js
```

这些是项目工作区 Git 功能，不是设置页全局 git identity。

API 和令牌移除范围：

```text
src/components/settings/view/tabs/api-settings/
src/components/settings/hooks/useCredentialsSettings.ts
public/api-docs.html
settings tab docs/tests for API key management
server/routes/settings.js API key management routes
```

如果项目创建流程仍需要 GitHub token，应把一次性 token 输入保留在项目创建流程中，或把必要的 credential 读取能力留给项目创建，不再通过设置页暴露“API 和令牌”管理面板。

## 智能体页

智能体页只保留账户状态：

```text
智能体
  |
  +-- Codex
  |     +-- 认证状态
  |     +-- 额度
  |
  +-- OpenCode
        +-- OpenCode icon
        +-- OpenCode 可用状态
        +-- 内部已连接 provider
```

需要移除：

- `AgentCategory = 'mcp'`。
- `AgentCategoryTabsSection` 中的 MCP tab。
- `McpServersContent` 渲染入口。
- 设置页里的 Codex MCP 表单弹窗入口和对应状态管理。

后端的 Codex MCP 路由若仍被其他功能使用，可以保留；这次重点是移除设置页卡片和设置页测试覆盖。

## OpenCode 状态

当前前端在 `Settings.tsx` 中给 OpenCode 传入硬编码未连接状态，这会掩盖实际 provider 已连接的情况。执行阶段应建立真实状态路径：

```text
OpenCode/co status source
  |
  v
server status endpoint
  |
  v
useSettingsController
  |
  v
AgentListItem + AccountContent
```

建议状态结构：

```json
{
  "authenticated": true,
  "email": null,
  "provider": "anthropic",
  "baseUrl": null,
  "providers": [
    { "name": "anthropic", "connected": true },
    { "name": "openai", "connected": false }
  ]
}
```

前端展示规则：

- 有已连接 provider 时，显示 `已连接：<provider>`。
- 只有 OpenCode CLI 可用但没有 provider 连接时，显示 `OpenCode 可用，尚未连接 provider`。
- 状态检查失败时显示后端错误摘要。

## OpenCode icon

`SessionProviderLogo` 不能再把未知或 OpenCode provider 落到 `ChatGptLogo`。执行阶段应新增 `OpenCodeLogo` 或引入本地 OpenCode icon 资产，并明确分支：

```text
provider=codex     -> Codex/ChatGPT logo
provider=opencode  -> OpenCode logo
model includes kimi -> Kimi logo
unknown            -> neutral fallback
```

## 诊断中文化

`RuntimeDiagnosticsTab` 应改为 i18n 文案，不再硬编码英文。中文界面下至少覆盖：

- `运行诊断`
- `服务进程可见的 oz、wo、co 命令`
- `整体状态`
- `成功` / `失败`
- `命令路径`
- `运行目录`
- `版本`
- `契约能力`
- `PATH`
- `正在加载诊断...`
- `加载诊断失败`

## 左侧导航栏工具区

左侧导航顶部不再承载项目操作按钮，只保留品牌和标题。当前顶部按钮应拆分处理：

```text
刷新项目          -> 移到底部工具区
新建项目          -> 移到底部工具区
搜索项目          -> 移除
搜索聊天记录      -> 移到底部工具区
设置              -> 移到底部工具区
收起侧边栏        -> 移到底部工具区（桌面端）
```

调整后的结构：

```text
sidebar
  |
  +-- header
  |     +-- brand/title only
  |
  +-- project list
  |
  +-- footer actions
        +-- refresh projects
        +-- create project
        +-- open chat history search
        +-- settings
        +-- collapse sidebar (desktop)
```

设计约束：

- 桌面展开态：底部工具区用图标按钮或紧凑按钮承载操作，项目列表仍占据中间滚动区域。
- 移动抽屉态：底部工具区必须避开 safe-area，并保持按钮可点击。
- 折叠态：不再出现项目搜索按钮；可保留展开、搜索聊天记录、设置等当前有意义操作。
- 移除项目搜索后，`searchFilter` 仅在执行阶段确认无其他调用时删除；若还有内部状态依赖，应一并清理，而不是留下不可触达状态。

## 语言支持收敛

i18n 只保留：

```text
src/i18n/locales/
  |
  +-- en/
  +-- zh-CN/
```

执行阶段需要移除：

- `src/i18n/config.js` 中的 `ja`、`ko` import 和 resources。
- `src/i18n/languages.js` 中的日语、韩语选项。
- `src/i18n/locales/ja/` 和 `src/i18n/locales/ko/`。
- 仍读取 ja/ko locale 的历史测试。

保存了 `ja` 或 `ko` 的旧用户应在启动时回退到 `en`，而不是产生缺失资源错误。

## 测试策略

执行阶段需要新增或更新真实测试代码：

- Playwright 设置页验收测试：打开设置页，只能看到 `外观`、`智能体`、`诊断` 三个 tab，不能看到 `Git`、`API 和令牌`。
- Playwright 外观页测试：中文界面下外观页只展示深色模式和语言选择，不展示项目排序、代码编辑器、编辑器主题、自动换行、缩略图、行号和字体大小。
- Playwright 智能体页测试：智能体页不展示 MCP 服务器 tab 或卡片；OpenCode 卡片使用 OpenCode icon，并展示 fake 后端返回的已连接 provider。
- Playwright 诊断页测试：中文界面下诊断页标题、说明、状态、字段名、加载态和错误态都是中文。
- Playwright 左侧导航测试：顶部只保留品牌/标题，不再显示“搜索项目”按钮；刷新、新建项目、搜索聊天记录、设置和桌面收起侧栏操作出现在底部工具区。
- i18n 静态测试：`languages` 只包含 `en` 和 `zh-CN`，i18n resources 不再 import `ja` 或 `ko`，保存的 `ja`/`ko` 会回退到 `en`。
- server 测试：删除全局 git config 设置入口后，`/api/user/git-config` 不再可用；项目 Git 路由仍可用。
- server 测试：删除 API key 管理入口后，设置页 API key 路由不再可用；如果项目创建仍保留一次性 GitHub token，覆盖该业务路径不依赖设置页 tab。

这些测试覆盖用户真实行为：设置页能否正确收敛、旧入口是否消失、OpenCode 状态是否可信、中文诊断是否可读，以及语言包是否真正被移除。

## 风险

- 删除 API 和令牌 tab 可能影响私有仓库导入。执行阶段必须先审计 `ProjectCreationWizard` 和 `/api/settings/credentials` 调用点，再决定是删除 credential 后端还是迁移一次性 token 流程。
- 删除代码编辑器设置会让用户无法通过设置页调整编辑器行为。若编辑器仍依赖这些 localStorage key，应保留默认值读取，但不再暴露 UI。
- 删除 ja/ko locale 会影响已选择这些语言的旧用户。需要明确回退逻辑。
- OpenCode 已连接 provider 的准确来源依赖 CLI 或 `co doctor` 输出。执行阶段应使用稳定可测试的后端接口，并用 fake 输出固定契约。

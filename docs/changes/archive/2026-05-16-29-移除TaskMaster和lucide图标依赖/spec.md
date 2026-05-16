### 需求：必须彻底移除 TaskMaster 后端能力

系统不得继续暴露 TaskMaster API、项目探测或 WebSocket 事件分支。

#### 场景：后端不注册 TaskMaster 路由

- **当** 开发者阅读后端入口
- **则** 不得存在 `/api/taskmaster` 路由注册
- **且** 不得导入 `server/routes/taskmaster.js`

#### 场景：项目 read model 不再包含 TaskMaster metadata

- **当** 客户端请求项目列表或项目详情
- **则** 返回项目对象不得包含 `taskmaster` 专属字段
- **且** 后端不得扫描项目目录中的 `.taskmaster` 来生成 cbw 项目状态

#### 场景：WebSocket 不再广播 TaskMaster 事件

- **当** 后端处理实时消息
- **则** 不得生成或转发 `taskmaster-*` 专属事件
- **且** 前端聊天实时处理不得把 `taskmaster-*` 作为全局项目刷新事件

### 需求：必须彻底移除 TaskMaster 前端入口

用户界面不得再出现 tasks tab、TaskMaster 设置、TaskMaster banner 或侧边栏 TaskMaster 指示器。

#### 场景：应用启动不再挂载 TaskMaster providers

- **当** 前端应用渲染根组件
- **则** provider 树中不得包含 `TaskMasterProvider`
- **且** 不得包含 `TasksSettingsProvider`

#### 场景：工作区不显示 tasks tab

- **当** 用户进入任意项目工作区
- **则** tab 列表只显示保留的核心工作区入口
- **且** 不得显示 TaskMaster 或 tasks 入口

#### 场景：旧 tasks 状态不会导致空白主视图

- **当** 历史本地状态或旧链接要求打开 `activeTab=tasks`
- **则** 应回落到保留的可用视图
- **且** 主内容区不得因为已删除面板而空白

#### 场景：聊天空态不显示 NextTaskBanner

- **当** 用户在项目中打开聊天空态
- **则** 页面不得出现初始化 TaskMaster、下一任务或生成任务的提示
- **且** 聊天输入和 provider 选择仍可正常使用

#### 场景：设置页不显示 tasks 设置

- **当** 用户打开设置页
- **则** 不得出现 TaskMaster 安装状态、启用 TaskMaster 集成或 tasks 设置入口
- **且** 历史调用 `initialTab=tasks` 时必须落到现有保留设置页

### 需求：必须移除 lucide-react 依赖

项目不得继续依赖或导入 lucide 图标库。

#### 场景：依赖清单不包含 lucide-react

- **当** 开发者检查 `package.json`
- **则** `dependencies` 中不得存在 `lucide-react`
- **且** 锁文件不得保留 lucide-react 包解析记录

#### 场景：源码不导入 lucide-react

- **当** 执行契约测试扫描 `src/`
- **则** 不得发现 `from 'lucide-react'` 或 `from "lucide-react"`
- **且** 不得继续使用 `LucideIcon` 类型

#### 场景：保留按钮仍可访问

- **当** 用户使用侧边栏、设置、文件、git、聊天和工作流的保留操作
- **则** 关键按钮必须仍有可访问名称
- **且** 测试应验证行为或 `aria-label`，不得验证图标组件名

### 需求：必须清理已删除 assets 的引用

应用入口不得继续请求已经删除的 public 图标和 logo 文件。

#### 场景：HTML 入口不引用失效 favicon 和 apple icons

- **当** 浏览器加载 `index.html`
- **则** HTML 不得引用 `/favicon.svg`、`/favicon.png` 或 `/icons/icon-*.png`
- **且** 仍必须保留正常加载前端入口脚本

#### 场景：manifest 不引用失效 icons

- **当** 浏览器请求 `manifest.json`
- **则** manifest 不得包含指向 `/icons/` 的已删除 icon 列表
- **且** manifest JSON 必须保持合法

#### 场景：provider 和 auth UI 不引用失效 logo

- **当** 用户打开登录、设置或 provider 选择相关 UI
- **则** 页面不得请求 `/logo.svg`、`/icons/codex.svg`、`/icons/codex-white.svg` 或 `/icons/claude-ai-icon.svg`
- **且** provider 名称仍应以文本或现有非 asset 组件可识别

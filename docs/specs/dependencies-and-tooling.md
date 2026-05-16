# 依赖与工具规格

> 合并自归档提案：`2026-05-16-29-移除TaskMaster和lucide图标依赖`

## 需求：系统不得包含 TaskMaster 后端能力

系统不得继续暴露 TaskMaster API、项目探测或 WebSocket 事件分支。

### 场景：后端不注册 TaskMaster 路由

- **当** 开发者阅读后端入口
- **则** 不得存在 `/api/taskmaster` 路由注册
- **且** 不得导入 `server/routes/taskmaster.js`

### 场景：项目 read model 不再包含 TaskMaster metadata

- **当** 客户端请求项目列表或项目详情
- **则** 返回项目对象不得包含 `taskmaster` 专属字段
- **且** 后端不得扫描项目目录中的 `.taskmaster` 来生成 cbw 项目状态

### 场景：WebSocket 不再广播 TaskMaster 事件

- **当** 后端处理实时消息
- **则** 不得生成或转发 `taskmaster-*` 专属事件
- **且** 前端聊天实时处理不得把 `taskmaster-*` 作为全局项目刷新事件

## 需求：系统不得包含 TaskMaster 前端入口

用户界面不得再出现 tasks tab、TaskMaster 设置、TaskMaster banner 或侧边栏 TaskMaster 指示器。

### 场景：应用启动不再挂载 TaskMaster providers

- **当** 前端应用渲染根组件
- **则** provider 树中不得包含 `TaskMasterProvider`
- **且** 不得包含 `TasksSettingsProvider`

### 场景：工作区不显示 tasks tab

- **当** 用户进入任意项目工作区
- **则** tab 列表只显示保留的核心工作区入口
- **且** 不得显示 TaskMaster 或 tasks 入口

### 场景：旧 tasks 状态不会导致空白主视图

- **当** 历史本地状态或旧链接要求打开 `activeTab=tasks`
- **则** 应回落到保留的可用视图
- **且** 主内容区不得因为已删除面板而空白

### 场景：聊天空态不显示 NextTaskBanner

- **当** 用户在项目中打开聊天空态
- **则** 页面不得出现初始化 TaskMaster、下一任务或生成任务的提示
- **且** 聊天输入和 provider 选择仍可正常使用

### 场景：设置页不显示 tasks 设置

- **当** 用户打开设置页
- **则** 不得出现 TaskMaster 安装状态、启用 TaskMaster 集成或 tasks 设置入口
- **且** 历史调用 `initialTab=tasks` 时必须落到现有保留设置页

## 需求：系统不得依赖 lucide-react 图标库

项目不得继续依赖或导入 lucide 图标库。

### 场景：依赖清单不包含 lucide-react

- **当** 开发者检查 `package.json`
- **则** `dependencies` 中不得存在 `lucide-react`
- **且** 锁文件不得保留 lucide-react 包解析记录

### 场景：源码不导入 lucide-react

- **当** 执行契约测试扫描 `src/`
- **则** 不得发现 `from 'lucide-react'` 或 `from "lucide-react"`
- **且** 不得继续使用 `LucideIcon` 类型

### 场景：保留按钮仍可访问

- **当** 用户使用侧边栏、设置、文件、git、聊天和工作流的保留操作
- **则** 关键按钮必须仍有可访问名称
- **且** 测试应验证行为或 `aria-label`，不得验证图标组件名

## 需求：系统不得引用已删除的 public assets

应用入口不得继续请求已经删除的 public 图标和 logo 文件。

### 场景：HTML 入口不引用失效 favicon 和 apple icons

- **当** 浏览器加载 `index.html`
- **则** HTML 不得引用 `/favicon.svg`、`/favicon.png` 或 `/icons/icon-*.png`
- **且** 仍必须保留正常加载前端入口脚本

### 场景：manifest 不引用失效 icons

- **当** 浏览器请求 `manifest.json`
- **则** manifest 不得包含指向 `/icons/` 的已删除 icon 列表
- **且** manifest JSON 必须保持合法

### 场景：provider 和 auth UI 不引用失效 logo

- **当** 用户打开登录、设置或 provider 选择相关 UI
- **则** 页面不得请求 `/logo.svg`、`/icons/codex.svg`、`/icons/codex-white.svg` 或 `/icons/claude-ai-icon.svg`
- **且** provider 名称仍应以文本或现有非 asset 组件可识别

---

> 合并自归档提案：`2026-05-16-30-进一步精简仓库源码和脚本资源`

## 需求：精简范围必须限定在 tracked 仓库文件

执行本变更时不得修改 `.gitignore` 已忽略的运行态、缓存、依赖、构建产物或本地工具状态。

### 场景：实现变更不触碰 ignored 路径

- **当** 开发者查看本变更的文件列表
- **则** 所有新增、修改、删除路径都必须来自 `git ls-files` 或将要新增的 tracked 源码/测试/文档路径
- **且** 不得包含 `node_modules/`、`dist/`、`.wo/`、`.taskmaster/`、`.agents/cache/`、`.openspec/cache/`、`tests/test-results/`、`authdb/`、数据库文件或日志文件

### 场景：ignored 文件只报告不处理

- **当** 精简扫描发现 ignored 路径中存在旧缓存或生成文件
- **则** 执行阶段可以在总结中说明
- **但** 不得删除、移动或格式化这些 ignored 文件

## 需求：前端源码必须减少无复用薄层

完成后，前端源码中只服务单一调用方的薄层文件应被合并或删除，核心业务域边界仍要保留。

### 场景：单一调用方的子组件被合并

- **当** `view/subcomponents` 下某个组件只被同一目录的一个父组件引用
- **且** 该组件没有独立状态、复杂副作用或复用测试
- **则** 应合并到父组件或同域局部组件文件
- **且** 合并后用户可见 UI 和可访问名称保持不变

### 场景：单一调用方的 types/constants/utils 被合并

- **当** 某个 `types`、`constants` 或 `utils` 文件只服务单个组件
- **则** 应内联到该组件或同域文件
- **且** 不得继续保留只导出一两个局部值的薄壳文件

### 场景：复杂业务域不会被压成大文件

- **当** 文件属于聊天工具渲染、代码编辑器 markdown/mermaid、Git 变更列表、workflow 详情或 shell 连接管理
- **则** 只有无调用方残余和重复 props 可以删除
- **且** 不得为了减少文件数破坏清晰业务边界

### 场景：上一份提案的残余入口被清理

- **当** TaskMaster 和 lucide 依赖已经移除
- **则** 前端不得保留空的 TaskMaster/tasks i18n key、props 透传、tab 类型或图标 adapter
- **且** 不得保留只为已删除 public asset 服务的 UI 入口

## 需求：后端源码必须收敛历史兼容和重复 helper

后端应保持项目、会话、workflow、Git、Shell 和 runtime diagnostics 的稳定契约，同时删除已无调用方的迁移残余和重复判断逻辑。

### 场景：项目 read model 响应保持稳定

- **当** 客户端请求项目列表或项目详情
- **则** 项目名称、路径、会话集合、workflow 集合、provider 状态和可见性规则保持兼容
- **且** 不得重新引入上一份提案已删除的 TaskMaster metadata

### 场景：会话路由 helper 不重复实现

- **当** 后端处理手动会话、`cN` route、workflow child session 和 provider draft
- **则** 相同的 route/session 判定逻辑应集中在一个可测试 helper 中
- **且** 不得在多个 route 或 read model 文件中保留语义相同的正则和字符串拆分逻辑

### 场景：历史迁移分支只在有测试价值时保留

- **当** 代码中存在 `.cbw`、项目内 `.wo` 或 legacy workflow 字段的兼容读取
- **则** 若仍用于用户数据迁移，必须有对应测试证明
- **否则** 应删除该分支或把它降级为测试夹具中的历史输入

### 场景：runtime diagnostics 不重复查找可执行文件

- **当** 后端检查 oz、wo、co、Codex、OpenCode、Pi 等运行依赖
- **则** executable 查找、PATH 诊断和错误格式化应复用同一套工具
- **且** 保持缺失命令时的错误信息可读

## 需求：脚本和 public 资源必须可追溯

仓库保留的脚本和 public 资源必须有明确入口；没有入口的历史资源应删除或移动到测试辅助目录。

### 场景：scripts 文件都有调用来源

- **当** 执行契约测试扫描 `scripts/`
- **则** 每个脚本必须被 `package.json` script、README、源码或测试引用
- **且** 没有引用来源的脚本不得继续留在发布文件集合中

### 场景：public 资源都有静态入口

- **当** 执行契约测试扫描 `public/`
- **则** 每个 public 文件必须被 HTML、manifest、前端源码、后端静态服务或 README 引用
- **且** icon/PWA 生成脚本、缓存清理页和 service worker 退役文件若无入口引用必须删除

### 场景：发布清单不包含测试和历史工具残余

- **当** 开发者检查 `package.json` 的 `files` 字段
- **则** 只应包含运行 cbw 所需的 server、shared、dist、必要 scripts 和文档
- **且** 不应因为历史诊断脚本把无关资源发布出去

## 需求：精简后核心用户路径必须保持可用

本次精简不得破坏 cbw 当前核心使用路径。

### 场景：主工作区仍能完成常用操作

- **当** 用户进入一个已有项目
- **则** 可以打开聊天、发送消息、切换 provider、查看历史会话、打开文件树、编辑文本文件、查看 Git 面板和打开 Shell
- **且** 页面不得因为被合并组件或删除资源出现空白区域

### 场景：workflow 详情仍能展示

- **当** 项目包含 oz/wo workflow 运行记录
- **则** workflow 列表、阶段进度、artifact 链接、child session 链接和详情页仍按 read model 展示
- **且** 不得读取 ignored 的项目内 `.wo/runs` 作为当前事实来源

### 场景：设置页和诊断仍能定位运行依赖问题

- **当** oz、wo、co 或 provider CLI 缺失
- **则** 设置页和后端 diagnostics 仍返回明确的缺失命令、检查动作和 PATH 信息
- **且** 不得因为合并 helper 丢失 provider 维度

## 需求：源码说明和测试必须跟随重构移动

合并或移动源码时，业务目的说明和测试必须同步更新。

### 场景：新增或移动源码保留文件目的说明

- **当** 执行阶段新增或移动前端、后端、shared 源码文件
- **则** 文件开头必须说明该文件的业务目的
- **且** 非平凡函数必须保留能解释业务逻辑的 docstring

### 场景：测试不只检查组件存在

- **当** 更新前端测试
- **则** 测试应验证真实用户路径、可访问名称、API 响应或业务状态
- **且** 不得只断言某个被合并后的组件文件仍存在

---

> 合并自归档提案：`2026-05-17-31-统一迁移JS代码到TypeScript`

## 需求：tracked JS 源码必须迁移到 TypeScript

仓库中被 git 跟踪的源码、脚本、配置和测试应统一使用 TypeScript。

### 场景：前端入口和组件不再使用 JSX 文件

- **当** 开发者扫描 `src/`
- **则** 不得存在 `.jsx` 文件
- **且** `src/main.jsx` 必须迁移为 `src/main.tsx`
- **且** React 组件必须用 `.tsx` 表达 props、context 和事件类型

### 场景：后端和 shared 不再使用 JS 源码

- **当** 开发者扫描 `server/` 和 `shared/`
- **则** 不得存在 `.js`、`.mjs` 或 `.cjs` 源码文件
- **且** 共享工具必须从 `.ts` 源码直接导出运行函数和类型

### 场景：脚本和配置纳入迁移范围

- **当** 开发者扫描 `scripts/` 和根目录配置文件
- **则** 保留的脚本和配置必须迁移为 `.ts`
- **且** 如果外部工具短期只能加载 JS shim，该 shim 必须列入例外清单并说明退出条件

### 场景：测试文件迁移为 TypeScript

- **当** 开发者扫描 `tests/`
- **则** server、spec、e2e、manual 测试文件和 helper 应迁移为 `.ts`
- **且** 测试仍然验证真实业务行为，而不是只验证文件扩展名

## 需求：TypeScript 配置必须覆盖全仓核心代码

迁移完成后 typecheck 应覆盖前端、后端、共享工具、脚本和测试关键路径，不能继续依赖 `allowJs`。

### 场景：tsconfig 不再允许 JS 兜底

- **当** 开发者运行 TypeScript 配置契约测试
- **则** 所有主 tsconfig 都不得设置 `allowJs: true`
- **且** 不得通过排除 JS 文件来掩盖未迁移代码

### 场景：前后端配置分离

- **当** 开发者查看 tsconfig
- **则** 前端、Node 服务端和测试应有清晰的配置边界
- **且** `pnpm run typecheck` 必须覆盖这些边界

### 场景：编译输出不进入仓库

- **当** 服务端 TypeScript 需要编译为 Node 可执行 JS
- **则** 输出目录必须位于 `.gitignore` 已忽略路径
- **且** 不得提交编译产物

## 需求：Node 运行入口必须在迁移后可执行

把 server 和 scripts 改成 TS 后，所有命令入口必须仍可运行。

### 场景：开发服务可启动

- **当** 开发者运行 `pnpm run server`
- **则** 后端应通过明确的 TS runner 或编译产物启动
- **且** 不得指向 Node 无法直接执行的 `.ts` 文件

### 场景：CLI bin 可执行

- **当** 用户执行 `cbw`
- **则** bin 入口必须指向可被 Node 执行的文件
- **且** 行为保持与迁移前的 `server/cli.js` 一致

### 场景：postinstall 脚本可执行

- **当** 用户运行 `pnpm install`
- **则** postinstall 不得因为脚本迁移为 TS 而失败
- **且** 不得依赖未声明的传递依赖执行 TS

### 场景：测试 runner 可执行 TS 测试

- **当** 开发者运行 `pnpm run test:server` 和 `pnpm run test:spec`
- **则** Node test 与 Playwright 都必须能加载 TS 测试和 TS helper
- **且** 测试命令不应继续扫描旧 `.js` 测试模式

## 需求：JS 声明配对必须消失

迁移后不得继续维护 `.js` 实现和 `.d.ts` 声明的重复源。

### 场景：shared 声明由 TS 源码生成或导出

- **当** 开发者扫描 `shared/`
- **则** 不得存在与同名 `.js` 文件配对的 `.d.ts`
- **且** 类型必须从 `.ts` 源码中维护

### 场景：前端工具声明不再手写配对

- **当** 开发者扫描 `src/components` 和 `src/hooks`
- **则** 不得存在 `messageDedup.js`、`sessionMessageDedup.js`、`sessionActivityState.js` 这类 JS 实现配对声明
- **且** 调用方导入路径必须指向 TS 模块

## 需求：业务行为必须保持不变

TypeScript 迁移不得改变用户可见行为或 API 契约。

### 场景：项目和会话行为保持稳定

- **当** 用户打开项目、查看会话、创建手动会话或续聊
- **则** 项目列表、会话路由、provider 状态和消息渲染保持迁移前行为
- **且** 后端响应字段不因类型迁移被重命名或删除

### 场景：工作区工具保持可用

- **当** 用户使用聊天、文件树、编辑器、Git 面板、Shell 面板、设置页和 workflow 详情
- **则** 这些路径仍按真实业务测试通过
- **且** 页面不得因为导入扩展名或类型转换错误空白

### 场景：运行依赖诊断保持可读

- **当** oz、wo、co、Codex、OpenCode 或 Pi 缺失
- **则** diagnostics 返回的缺失命令、检查动作和 PATH 信息保持清晰
- **且** 类型迁移不得吞掉原有错误原因

## 需求：迁移质量必须可审查

迁移不是无类型重命名，必须让审阅者能看到业务类型边界。

### 场景：新增类型表达真实业务结构

- **当** 迁移 API response、WebSocket message、workflow run、provider session、project config 等对象
- **则** 类型命名必须表达业务含义
- **且** 不得用宽泛 `Record<string, unknown>` 替代已知稳定字段

### 场景：`any` 只能用于外部输入边界

- **当** 代码需要处理未知 JSON、CLI 输出或第三方库事件
- **则** 可以在解析边界短暂使用 `unknown` 或受控 `any`
- **但** 进入业务函数前必须归一化为明确类型

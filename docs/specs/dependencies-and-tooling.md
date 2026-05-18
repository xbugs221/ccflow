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

---

> 合并自归档提案：`2026-05-17-32-清理残留测试并统一pnpm-test`

## 需求：`pnpm test` 是全量验收入口

仓库提供覆盖全部关键质量门禁的统一测试命令。

### 场景：全量测试入口覆盖所有现有测试层

- **当** 开发者运行 `pnpm test`
- **则** 必须执行 `pnpm run typecheck`
- **且** 必须执行 `pnpm run test:server`
- **且** 必须执行 `pnpm run test:spec`
- **且** 必须执行 `pnpm run test:e2e`

### 场景：browser spec 不得被排除在全量入口之外

- **当** `pnpm test` 执行 `pnpm run test:spec`
- **则** `test:spec` 必须继续包含 `test:spec:browser`
- **且** browser spec 失败必须导致 `pnpm test` 失败

### 场景：最终验收必须全绿

- **当** 任何变更完成后运行 `pnpm test`
- **则** 命令必须以 0 退出
- **且** 不得存在为了通过而新增的无条件 skip 或条件跳过

## 需求：历史重复测试必须归并到 canonical 测试

每个业务契约应有清晰的测试归属，避免旧 proposal 副本与当前测试互相冲突。

### 场景：重复的 server 契约测试被归并

- **当** 根目录 proposal 测试与 `tests/server` 中的测试覆盖同一业务契约
- **则** 应保留 `tests/server` 中的 canonical 测试
- **且** 旧 proposal 测试中的独有断言必须迁入 canonical 测试后再删除旧副本

### 场景：重复的 spec 契约测试被归并

- **当** 根目录 proposal 测试与 `tests/spec` 中的测试覆盖同一浏览器或静态契约
- **则** 应保留 `tests/spec` 或明确命名的 canonical 测试
- **且** Playwright 配置不得继续引用被删除的旧路径

### 场景：当前行为优先于旧 proposal 预期

- **当** 旧测试与近期提案的实现意图冲突
- **则** 应更新或删除旧测试
- **且** 不得为了旧测试恢复已被近期提案废弃的行为

## 需求：测试运行态路径必须使用 XDG state helper

测试应跟随当前 wo/cbw 运行态路径策略，不得硬编码项目内路径。

### 场景：wo state 读写使用当前运行态根目录

- **当** 测试需要读写 wo `state.json`
- **则** 必须通过 `resolveWoRunsRoot`、`resolveWoRunStatePath` 或 fixture helper 解析路径
- **且** 不得把项目内 `.wo/runs/<run>/state.json` 当作当前真实运行态

### 场景：cbw 项目配置使用当前 state config

- **当** 测试需要验证项目会话 UI 状态、收藏、待处理或隐藏配置
- **则** 必须通过 `getProjectLocalConfigPath` 读取当前项目 state config
- **且** 不得只检查旧项目内 `.cbw/conf.json`

### 场景：展示用 artifact path 与真实 state path 区分

- **当** wo state 中包含 `.wo/runs/.../logs/...` 这类展示路径
- **则** 测试可以断言其作为 artifact 文本或相对路径显示
- **但** 不得把该展示路径误用为测试夹具的真实 state 读写位置

## 需求：清理后不得残留旧失败基线

测试套件中的失败不得作为长期豁免存在。

### 场景：旧失败清单被消除

- **当** 开发者运行 browser spec 和 e2e
- **则** 历史上记录的 selector、fixture 路径、UI 文案和时序应全部修复或删除
- **且** 若有新的真实回归，必须作为对应变更阻塞问题处理

### 场景：文档说明当前测试策略

- **当** 审阅者查看变更文档
- **则** 应能看到哪些测试被删除、归并、更新或修复
- **且** 能通过 `pnpm test` 复现最终验收结果

## 需求：测试契约本身应纳入验收范围

新增的测试基础设施变更必须有对应的契约测试确保不退化。

### 场景：pnpm test 入口可被契约断言

- **当** 运行 test:spec:node
- **则** 应有测试断言 `pnpm test` 覆盖 typecheck、server、spec、e2e 各层
- **且** 断言 `test:spec` 覆盖 node 和 browser 两个维度

### 场景：已删除的重复测试不再出现

- **当** 运行 test:spec:node
- **则** 应有测试断言历史上删除的旧 proposal 测试路径不再存在于 `tests/`
- **且** 断言对应的 canonical 测试仍存在于 `tests/server/` 或 `tests/spec/`

### 场景：stale 旧文件名不重现

- **当** 运行 test:spec:node
- **则** 应有测试扫描 `tests/` 确认不引用已删除的 `.jsx`、旧运行态路径和旧重复日期路径

### 场景：fixture helper 路径与生产一致

- **当** 运行 test:spec:node
- **则** 应有测试验证 playwright fixture 导入并使用 `resolveWoRunStatePath`
- **且** 不得硬编码 `.wo/runs` 或 `.cbw/runs` 路径

---

> 合并自归档提案：`2026-05-18-33-收敛co-wo会话状态到前端只读展示`

## 需求：前端不得复制 co/wo 生命周期状态机

cbw 前端应只发送用户意图、展示本地 pending 反馈、读取 co/wo 权威状态并渲染结果，不得用本地 Set 或 realtime payload 作为 provider/workflow 生命周期事实源。

### 场景：发送消息后不直接宣告 provider session running

- **当** 用户在 Codex、OpenCode 或 Pi 会话中发送消息
- **则** 前端可以显示本地 pending 用户消息和防重复提交状态
- **且** 不得仅因为点击发送就把具体 provider session 记为权威 running
- **并且** 是否显示可中断运行态必须等待 co 返回 `session-status`、`active_turn_id` 或等价 read model

### 场景：路由刷新后运行态从 co 恢复

- **当** 用户刷新或重新打开一个仍有 `active_turn_id` 的会话
- **则** 前端应通过 `check-session-status` 或项目 read model 恢复运行态
- **且** 发送按钮应显示停止按钮
- **并且** 不得依赖刷新前遗留的前端 `processingSessions`

### 场景：workflow 阶段状态来自 wo

- **当** 用户打开 workflow 详情或 workflow 子会话
- **则** stage、run status、当前轮次和中断状态来自 wo read model
- **且** chat 的 provider turn 状态只用于该子会话输入区是否可停止
- **并且** chat 本地状态不得覆盖 wo 展示的 stage 事实

## 需求：三 provider 的推送内容不得直接成为最终消息渲染事实

Codex、OpenCode、Pi 的 WebSocket 内容事件应只触发 ack、状态更新或 read model 刷新。最终 assistant 正文、reasoning、工具卡片和文件变更必须来自持久化会话消息 read model。

### 场景：运行中 provider 内容事件不直接插入 transcript

- **当** Codex、OpenCode 或 Pi 在运行中推送 assistant content item
- **则** 前端不得把该 payload 直接追加为最终 assistant 消息
- **且** 可触发对应会话消息 read model 的刷新
- **并且** 页面中不得出现只存在于 realtime payload、尚未落盘的 assistant 正文

### 场景：持久化 read model 更新后按权威顺序显示

- **当** provider 的持久化会话消息新增用户消息、assistant 正文、reasoning 或工具结果
- **且** 前端收到刷新事件或完成事件
- **则** 页面应按 read model 顺序渲染消息
- **并且** 工具卡片结构、折叠状态和正文顺序与刷新浏览器后的结果一致

### 场景：重复推送不会重复渲染

- **当** 同一 provider 会话连续收到重复 `projects_updated`、content event 或 complete event
- **则** 同一条 assistant 正文、用户消息和工具卡片最多显示一次
- **并且** 用户滚动位置和已加载历史窗口不应被重复推送打乱

## 需求：运行中 UI 只保留停止按钮表达

底部运行状态条应删除，避免与发送按钮状态重复。

### 场景：发送按钮变为停止按钮

- **当** 当前会话处于本地 dispatching 或 co running 状态
- **则** composer action button 应从发送变为停止
- **且** 用户能通过该按钮请求中断当前 turn
- **并且** 没有 co active turn 时不得向错误 turn 发送 abort

### 场景：底部状态条不再出现

- **当** 当前会话正在运行
- **则** 输入框上方或底部不得显示旧的 `ProcessingStatus` 条
- **且** 页面不得显示 fake tokens、运行秒数、`esc to stop` 等旧状态条内容
- **并且** 断线提示、附件、模型选择和 follow latest 控件保持可用

## 需求：错误和超时只作为 UI 反馈，不改写权威生命周期

网络超时、provider 错误和 abort 失败应反馈给用户，但不得让前端永久持有与 co/wo 不一致的运行态。

### 场景：网络超时后可恢复

- **当** 发送后服务端长时间没有任何 ack 或 status
- **则** 前端可以显示网络异常错误
- **且** 应清理本地 pending dispatch 状态
- **并且** 后续收到 co status 或 read model 更新时，应以 co/wo 权威状态恢复页面

### 场景：provider 错误后状态收敛

- **当** Codex、OpenCode 或 Pi 返回 error/failed/aborted
- **则** 前端应显示错误或中断反馈
- **且** 停止按钮应按 co 返回状态消失
- **并且** 不得保留本地 processing 残留导致刷新后继续显示运行中

---

> 合并自归档提案：`2026-05-18-34-统一工作流planner会话编号契约`

## 需求：规划会话必须按 wo planner 角色读取

cbw 必须把 `wo` 当前契约中的 planner role 作为规划会话主来源，不得只读取 planning key。

### 场景：读取 codex planner 规划会话

- **给定** `wo state.json` 中存在 `sessions["codex:planner"] = "planner-thread-1"`
- **当** 用户打开 workflow 详情页
- **则** 规划行显示可进入的"会话"
- **且** 点击后进入该 run 的 planning child session route
- **并且** read model 中规划 sessionRef 的 `sessionId` 是 `planner-thread-1`

### 场景：读取非 Codex planner 规划会话

- **给定** planning 阶段配置的 tool 是 `pi`
- **且** `wo state.json` 中存在 `sessions["pi:planner"] = "pi-planner-1"`
- **当** cbw 构造 workflow read model
- **则** 规划行 sessionRef 的 provider 是 `pi`
- **且** session id 是 `pi-planner-1`
- **并且** 不得错误回退为 Codex provider

### 场景：兼容历史 planning key

- **给定** 旧运行态中只存在 `sessions["codex:planning"] = "legacy-planning-thread"`
- **当** 用户打开 workflow 详情页
- **则** cbw 仍能显示规划会话入口
- **但** 新增测试和 fixture 的主路径必须使用 `codex:planner`

### 场景：规划会话缺失

- **给定** `wo state.json` 中没有 planner/planning 会话 id
- **当** 用户打开 workflow 详情页
- **则** 规划行显示 `未知`
- **且** 不得用 run id、stage key 或 log 文件名伪造会话 id

## 需求：runnerProcesses 只能表达真实进程事实

cbw 不得从 `state.sessions` 或 stage 状态合成 runner process rows。没有真实 process 数据时，进程区必须隐藏。

### 场景：sessions-only 状态不显示进程区

- **给定** `wo state.json` 中存在 `sessions["codex:planner"]` 和 `sessions["codex:executor"]`
- **且** `state.processes` 不存在或为空
- **当** 用户打开 workflow 详情页
- **则** 角色摘要仍显示对应会话入口
- **但** 页面不显示 `workflow-runner-processes` 进程区
- **并且** read model 的 `runnerProcesses` 为空数组

### 场景：真实 processes 保留 pid

- **给定** `wo state.json` 中存在 `processes` 数组含 pid 和 session_id
- **当** cbw 构造 workflow read model
- **则** `runnerProcesses[0].pid` 是真实 pid
- **且** `runnerProcesses[0].sessionId` 是真实 session_id
- **并且** 前端展示时不得把 session_id 当作 pid

### 场景：process 没有 pid 不得伪造

- **给定** `state.processes[0].session_id = "reviewer-thread-1"`
- **且** 该 process 没有 `pid`
- **当** 用户查看进程区
- **则** 页面可以显示 `thread=reviewer-thread-1`
- **但** 不得显示 `pid=reviewer-thread-1`
- **并且** 不得把 session id 称为进程编号

## 需求：会话编号和进程编号在 UI 上语义分离

workflow UI 必须让用户能区分 provider 会话编号和系统进程编号。

### 场景：角色行展示会话编号入口

- **当** workflow 角色摘要展示 `规`、`写`、`审`、`修` 或 `存` 的会话入口
- **则** 这些入口表示 provider session id
- **且** 点击进入对应 workflow child session
- **并且** 不得暗示它是 pid

### 场景：进程行展示 process metadata

- **当** workflow 详情页展示真实进程行
- **则** pid 只来自 `process.pid`
- **且** thread/session 只来自 `process.sessionId`
- **并且** 二者应分开渲染或分开命名

## 需求：测试 fixture 必须贴近真实 wo 契约

cbw 的 workflow 测试数据必须使用当前 `wo` 的 role key，避免测试通过但真实运行态失败。

### 场景：fixture 使用 codex:planner

- **当** Playwright fixture 或 server read model 测试需要构造规划会话
- **则** 主路径必须写入 `sessions["codex:planner"]`
- **且** 不得只写 `sessions["codex:planning"]`

### 场景：旧 fixture 预期被更新

- **当** 测试断言 workflow runner process 区
- **则** 只有 fixture 显式提供 `processes` 时才断言进程区存在
- **并且** sessions-only fixture 应断言进程区不存在

---

> 合并自归档提案：`2026-05-18-35-修复Pi工作流子会话和oz列表加载`

## 需求：provider-aware wo sessions 必须生成 workflow child sessions

cbw 必须把 `wo state.sessions` 中的 provider role map 当作 workflow child session 来源，而不是只依赖 runner process rows。

### 场景：Pi executor sessions-only 状态可进入子会话

- **给定** `wo state.json` 中存在 `sessions["pi:executor"] = "pi-thread-1"`
- **且** `state.processes` 不存在或为空
- **当** cbw 构造 workflow read model
- **则** `childSessions` 包含 id 为 `pi-thread-1` 的子会话
- **且** 该子会话的 provider 是 `pi`
- **并且** 该子会话的 stageKey 是 `execution`

### 场景：sessions-only 状态不伪造进程

- **给定** `wo state.json` 只有 `sessions["pi:executor"]`
- **且** 没有真实 `processes`
- **当** cbw 构造 workflow read model
- **则** `runnerProcesses` 是空数组
- **但** workflow role summary 和 stage inspection 仍显示可进入的 Pi 会话

### 场景：explicit process 与 role session 去重

- **给定** `state.processes[0].session_id = "pi-thread-1"`
- **且** `sessions["pi:executor"] = "pi-thread-1"`
- **当** cbw 构造 child sessions
- **则** `pi-thread-1` 只出现一次
- **且** process pid 保留在 `runnerProcesses`
- **并且** child session 的 provider 仍是 `pi`

### 场景：非 Pi provider role map 同样可路由

- **给定** `sessions["opencode:executor"] = "opencode-thread-1"` 或 `sessions["codex:reviewer"] = "codex-thread-1"`
- **当** cbw 构造 workflow read model
- **则** 对应 child session 使用各自 provider
- **并且** 不得统一回退为 Codex

## 需求：Pi workflow child session 必须按 provider 加载消息

Pi workflow 子会话打开后，聊天页必须保留 workflow 和 provider 上下文，并从 co read model 读取消息。

### 场景：点击 Pi role row 进入 workflow child route

- **当** 用户在 workflow 详情页点击 `pi:executor` 对应的"会话"
- **则** 浏览器进入 `/runs/<runId>/sessions/<address>` 或 `/runs/<runId>/sessions/by-id/<sessionId>`
- **且** selected session 的 `workflowId` 是当前 run
- **并且** selected session 的 `__provider` 是 `pi`

### 场景：Pi child session 请求消息时携带 provider

- **给定** 当前 selected session provider 是 `pi`
- **当** 聊天页加载该 session 消息
- **则** 请求 `/api/projects/:projectName/sessions/:sessionId/messages` 时带有 `provider=pi`
- **且** 服务端不得尝试读取 Codex JSONL 作为 fallback

### 场景：co conversation 存在时返回 Pi 消息

- **给定** co conversation state 中 `provider = "pi"`
- **且** `provider_session_id = "pi-thread-1"`
- **并且** turns/events 中存在用户消息和 assistant 文本事件
- **当** 前端加载 `pi-thread-1` 的消息
- **则** 页面展示 co durable history 中的用户消息和 assistant 消息
- **并且** 消息 provider 标记为 `pi`

### 场景：co conversation 缺失时不跨 provider fallback

- **给定** wo state 记录了 `sessions["pi:executor"] = "pi-thread-missing"`
- **但** co 没有对应 conversation
- **当** 前端加载该 child session
- **则** 消息区可以为空或显示明确错误反馈
- **且** 不得显示同名 Codex/OpenCode 会话内容

## 需求：active oz changes API 必须走轻量路径

新建工作流弹窗读取 active oz changes 时，不得重建全项目 provider/session/sidebar read model。

### 场景：打开弹窗不触发全量项目会话扫描

- **当** 前端打开工作流操作弹窗
- **则** `/api/projects/:projectName/openspec/changes` 只解析当前 project path
- **且** 不调用全量 provider session population
- **并且** 不需要 `attachWorkflowMetadata(await getProjects())`

### 场景：返回未被 workflow claim 的 active changes

- **给定** `oz list --json` 返回 active changes `["a", "b"]`
- **且** 当前项目已有 workflow claim 了 `"a"`
- **当** 请求 active changes API
- **则** 返回 `["b"]`
- **并且** 排序规则与现有 `listProjectAdoptableOpenSpecChanges` 保持一致

### 场景：oz list 快速时接口不秒级等待

- **给定** 测试夹具中 `oz list --json` 立即返回
- **且** 当前项目 workflow read model 很小
- **当** 请求 `/openspec/changes`
- **则** 响应不应被 unrelated provider history 扫描拖慢
- **并且** 测试应能证明慢路径不再依赖全项目 `getProjects()`

## 需求：现有 33/34 方向不得回退

本变更必须兼容既有两个活动提案的架构方向。

### 场景：消息最终事实仍来自 co/wo read model

- **当** Pi workflow child session 运行中收到 realtime 事件
- **则** 页面可以刷新 read model
- **但** 最终 transcript 仍以 co durable conversation messages 为准

### 场景：session id 不被当作 pid

- **当** workflow 只有 `state.sessions` 而没有 `state.processes`
- **则** 页面不得显示 `workflow-runner-processes`
- **且** 不得把 `pi-thread-1` 显示成 pid

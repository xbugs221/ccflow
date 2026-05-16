## 背景

cbw 当前已经从 ccui 派生形态逐步收敛到本地 Web 工作台。上一份提案负责移除 TaskMaster 和 lucide/assets，这会释放大量前端组件、后端路由和 public 资源引用。本提案不重复该删除范围，而是在其基础上处理剩余结构问题。

本次精简的判断标准不是单纯追求最少文件数，而是让保留文件都能解释清楚：

- 是否承载独立业务边界。
- 是否有多个真实调用方。
- 是否有测试或文档能证明入口仍被使用。
- 是否只是历史迁移、旧资源、旧生成流程或旧插件留下的薄壳。

## 技术决策

### 决策 1：先删残余入口，再合并薄层

执行顺序必须先完成上一份提案中的 TaskMaster/lucide/assets 删除，再做本提案。否则薄组件合并时会混入即将删除的调用点，增加无效改动。

推荐顺序：

```text
29 删除 TaskMaster/lucide
└─ 30 精简仓库源码和脚本资源
   ├─ 静态扫描 tracked 文件
   ├─ 删除无调用方资源/脚本
   ├─ 合并单一调用方薄层
   └─ 跑业务回归测试
```

### 决策 2：前端按业务域保留边界，域内减少薄层

需要保留的边界：

```text
chat
code-editor
file-tree
git-panel
main-content
settings
shell
sidebar
workflow
app/auth/projects
```

每个边界内部可以合并以下薄层：

- 只被一个组件导入的 `constants`、`types`、`utils`。
- 只包装一段 JSX 且没有独立状态或复用点的 `view/subcomponents`。
- 只为删除后的 TaskMaster/tasks props 服务的透传字段。
- 只为旧图标库或旧 public 资源服务的 UI adapter。

不合并以下文件：

- 有多个调用方的 hook、parser、message transform、route helper。
- 复杂交互的独立组件，例如聊天工具渲染、编辑器 markdown/mermaid、Git 变更列表、workflow 详情。
- 会导致单文件超过当前可读边界的组件。

### 决策 3：后端只收敛重复与历史兼容，不重写核心 read model

`server/projects.js` 和 workflow read model 承担核心业务，不能为了“精简”做大规模语义重写。执行阶段应优先处理：

- 上一份提案删除后无调用方的 TaskMaster/MCP helper。
- provider session 路由中重复的 `cN`、manual draft、workflow child session 判断。
- 只为旧项目内 `.wo` 或 `.cbw` 迁移存在、且当前测试已经证明新 XDG 状态生效的兼容分支。
- 诊断逻辑中重复的 executable 查找和错误格式化。

如果某个兼容分支仍有真实用户数据迁移风险，应保留并把原因写入注释或测试名，而不是强行删除。

### 决策 4：脚本和 public 资源必须可追溯

保留规则：

```text
tracked script/public resource
├─ package.json scripts/bin/files 引用
├─ README 或开发文档说明了手动入口
├─ 前端入口、manifest、server 静态服务或源码直接引用
└─ 测试夹具或测试辅助显式引用
```

不满足上述任一条件的文件应删除。若文件仍有价值但只是测试辅助，应移动到 `tests/` 合适目录，并从生产发布清单中移除。

`public/generate-icons.js`、PWA 清理页和 service worker 退役脚本需要在上一份 assets 删除后重新判断。如果前端已经不注册 service worker，且没有页面或文档要求用户打开清理页，就应删除这些 public 资源，避免把历史清理机制继续发布。

### 决策 5：只处理 tracked 文件，忽略文件不参与精简

用户明确要求 ignore 的不要动。本提案的扫描、删除和重构必须以 `git ls-files` 为准，不能进入：

```text
node_modules/
dist/
.wo/
.taskmaster/
.agents/cache/
.openspec/cache/
tests/test-results/
authdb/
*.db
*.log
```

执行阶段如果发现 ignored 文件看起来“可删”，也只在最终报告中提示，不实际修改。

## 测试策略

执行阶段应把测试先写入本提案 `tests/` 目录，再同步到根测试套件：

- `repo-simplification-boundary.test.js`：读取 `.gitignore` 和 `git ls-files`，断言本次变更的文件集合都不是 ignored 路径。
- `script-resource-traceability.test.js`：扫描 `scripts/`、`public/`、`package.json`、README、源码和测试，断言保留脚本/资源都有引用来源。
- `frontend-core-flows.spec.js`：用真实业务路径验证项目进入、聊天发送、文件打开、Git 面板、Shell 面板、设置页和 workflow 详情。
- `server-contract-after-simplification.test.js`：覆盖项目 read model、手动会话路由、workflow read model、runtime diagnostics、Git API。
- `source-shape-contract.test.js`：扫描新增/移动源码的文件目的说明，检查不再残留上一份提案应删除的 TaskMaster/lucide 壳文件。

这些测试证明：

- 精简没有误碰本地运行态或 ignored 目录。
- 删除的是无入口资源和历史薄壳，不是用户可见能力。
- 保留的核心业务路径仍能从浏览器和后端 API 角度跑通。

## 风险与处理

- 风险：合并前端薄组件时把独立状态合进父组件，导致回归难定位。
  - 处理：只合并单一调用方且逻辑简单的文件；复杂组件只清理残余 props，不强行合并。
- 风险：删除后端兼容分支影响仍在迁移中的用户数据。
  - 处理：保留有测试证明的迁移路径；删除前为候选分支增加回归用例或确认已经没有入口。
- 风险：脚本看似无引用，但实际是人工排障入口。
  - 处理：若需要保留，必须在 README 或 package script 中补上入口，不能继续靠口头记忆。
- 风险：public 资源删除导致浏览器缓存中的旧页面请求 404。
  - 处理：先确认当前入口不再注册旧 service worker；必要时保留一个最小退役周期，并用测试说明保留原因。

## 历史测试更新记录

执行阶段更新了以下历史测试以适配 JS → TS 转换：

- `tests/server/chat-message-dedup.test.js`：导入路径 messageDedup.js → messageDedup.ts
- `tests/server/chat-session-message-dedup.test.js`：导入路径 sessionMessageDedup.js → sessionMessageDedup.ts
- `tests/server/model-constants.test.js`：导入路径 modelConstants.js → modelConstants.ts
- `tests/server/socket-message-utils.test.js`：导入路径 socket-message-utils.js → socket-message-utils.ts
- `tests/spec/test_legacy_claude_surfaces.js`：sessionActivityState.js → .ts，移除已删除的 ChatInputControls 断言
- `tests/spec/test_home_session_card_activity_ui.js`：导入路径 sessionActivityState.js → .ts
- `tests/2026-05-13-22-...test.js`：modelConstants.js → modelConstants.ts
- `tests/2026-05-13-2026-05-13-23-...test.js`：共享文件 JS + .d.ts 契约测试更新为 TS 统一模块契约

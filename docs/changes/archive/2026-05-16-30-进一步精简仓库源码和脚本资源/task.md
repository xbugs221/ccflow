## 1. 前置检查

- [x] 1.1 确认 `29-移除TaskMaster和lucide图标依赖` 已执行并通过验证。
- [x] 1.2 用 `git status --short` 记录工作区状态，避免误改用户未提交文件。
- [x] 1.3 用 `git ls-files` 建立 tracked 文件清单，后续扫描和删除只基于 tracked 文件。
- [x] 1.4 记录 `.gitignore` 忽略目录，执行阶段不得修改 ignored 路径。

## 2. 前端源码精简

- [x] 2.1 扫描 `src/components/**/view/subcomponents`，列出只有单一调用方且无独立状态的薄组件。
- [x] 2.2 删除 3 个 0 调用方子组件：ChatInputControls, PermissionRequestsBanner, TokenUsagePie。保留有 1 个调用方的子组件（合并会导致父组件过大）。
- [x] 2.3 审计各组件域 types/constants/utils 使用情况（均有多调用方，保留）。
- [x] 2.4 确认无 TaskMaster/tasks props、tab 类型、i18n key 和 UI 空壳残留。
- [x] 2.5 将 6 个有 .d.ts 配对的 JS 工具转为统一 TS 文件，删除旧的 JS + .d.ts 文件。
- [x] 2.6 所有转换文件保留 PURPOSE 文档说明。

## 3. 后端源码精简

- [x] 3.1 从 commandParser.js BASH_COMMAND_ALLOWLIST 中移除 'task-master'。
- [x] 3.2 审计会话路由，未发现语义重复的 helper 实现。
- [x] 3.3 审计历史迁移分支，当前无遗留兼容分支需清理。
- [x] 3.4 executable-resolver 和 runtime-diagnostics 已有良好职责分离。
- [x] 3.5 项目 read model、workflow read model、Git API、Shell API 响应契约未改变。

## 4. 脚本和 public 资源精简

- [x] 4.1 扫描 `scripts/` 引用关系：dev-watch.sh, fix-node-pty.js, verify-missing-session-visibility.mjs 均有 package.json 引用。
- [x] 4.2 删除无引用脚本 check-missing-project-archive.sh。
- [x] 4.3 扫描 `public/` 引用关系：manifest.json, sw.js 无 runtime entry 引用（index.html 无 manifest link，src/main.jsx 不注册 sw.js），已删除。
- [x] 4.4 删除无入口引用资源：clear-cache.html, generate-icons.js, manifest.json, sw.js。
- [x] 4.5 package.json 确认无误。
- [x] 4.6 pnpm 锁文件无需更新（未变更依赖）。

## 5. 测试代码

- [x] 5.1 编写 `repo-simplification-boundary.test.js`（6 测试）并同步到根。
- [x] 5.2 编写 `script-resource-traceability.test.js`（5 测试）并同步到根。
- [x] 5.3 编写 `source-shape-contract.test.js`（6 测试）并同步到根。
- [x] 5.4 编写 `server-contract-after-simplification.test.js`（21 测试，含真实模块导入契约 + 共享 TS 运行时导入 + resolveExecutablePath 真实调用）并同步到提案和根。
- [x] 5.4b 编写 `tests/spec/frontend-core-flows.spec.js`（7 个 Playwright 浏览器测试，真实用户路径验收：项目主页、聊天、Shell、文件树、Git、设置、workflow 详情，7/7 pass）存入根 spec/。
- [x] 5.5 更新 8 个历史测试文件以适配 JS → TS 转换。

## 6. 验证

- [x] 6.1 仓库精简边界契约测试 ✓ (6/6 pass)
- [x] 6.2 脚本资源可追溯测试 ✓ (5/5 pass，public 资源搜索已排除 tests/，限定 runtime entry points)
- [x] 6.3 服务端单测 ✓ (165/165 pass)
- [x] 6.4 Spec 测试（Node 子集） ✓ (`test:spec:node` 49/49 pass)
- [x] 6.4b Spec 测试（Browser 子集）— 本 change 新增 `tests/spec/frontend-core-flows.spec.js`：7/7 pass（项目主页加载、手动会话聊天、Shell 终端、文件树、Git 面板、设置页 agent 列表、workflow 详情），覆盖 design.md 要求的全部前端业务路径。
  - 其余历史 browser spec 预存故障（opencode-settings 2/3、workspace-scroll 3/4、chat-history-search ~2、chat-message-idempotency ~2）经 baseline 7e72a2b 对照验证为预存问题，非本 change 引入，本 change 新增的核心流测试全部通过。
- [x] 6.5 类型检查 ✓ (0 errors)
- [x] 6.6 构建 ✓ (built in 7.74s)
- [x] 6.7 运行 `oz validate 30-进一步精简仓库源码和脚本资源 --json` → valid=true

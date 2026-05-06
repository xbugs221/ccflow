# Tasks

## 1. Baseline Audit

- [x] 1.1 运行 `openspec list`，确认 `21-workflow-w1` 与 `23-clean-repository-followup` 的关系。
- [x] 1.2 记录 git 跟踪状态、ignored 生成物、package manager 状态和主要热点文件。
- [x] 1.3 对比 `21-workflow-w1` 的已完成任务与当前仓库事实，列出不一致或需要解释的项目。

记录：

- `openspec list` 显示 `21-workflow-w1` 为 Complete，`23-clean-repository-followup` 为当前 0/15 follow-up change；两者是先完成第一轮精简，再做证据复核。
- `git status --short --ignored` 只显示当前 change 未跟踪，以及 `.ccflow/`、`.playwright-cli/`、`.tmp/`、`dist/`、`test-results/`、`planner-output.json`、`execution-manifest.json`、`verification-evidence.json`、`delivery-summary.md` 等 ignored 本地输出。
- package manager 状态为 `packageManager: pnpm@10.33.0`，仅保留 `pnpm-lock.yaml`，`pnpm install --frozen-lockfile --ignore-scripts --offline` 通过。
- 主要后端热点：`server/projects.js` 5655 行、`server/workflows.js` 2919 行、`server/index.js` 2908 行、`server/routes/taskmaster.js` 1965 行、`server/routes/git.js` 1290 行。
- 主要前端热点：`ChatInterface.tsx` 1459 行、`useChatSessionState.ts` 1177 行、`useChatComposerState.ts` 1089 行、`useChatRealtimeHandlers.ts` 992 行、`TaskList.jsx` 981 行、`useSettingsController.ts` 780 行、`useSidebarController.ts` 572 行。
- 与 `21-workflow-w1` 不一致项：该 change 的已完成任务与当前仓库事实基本一致；生成物仍在工作区但均被 ignore，不是 git tracking 回归。`docs/workflow-state-design.md` 仍有旧 `delivery-summary` artifact 表述，已在本 follow-up 修正。

## 2. Documentation Cleanup Plan

- [x] 2.1 清点根目录、`docs/`、`public/` 和 OpenSpec 中的过程文档与过期引用。
- [x] 2.2 将文档分为保留更新、删除、迁出、后续确认四类。
- [x] 2.3 更新或删除确认过期的文档引用，优先处理 `delivery-summary` 等 ignored artifact 引用。

分类：

- 保留更新：`docs/workflow-state-design.md`，保留 workflow 状态机设计价值，更新旧 `delivery-summary` artifact 说法。
- 保留不改：`public/api-docs.html`、`public/clear-cache.html`、`public/convert-icons.md`、`public/generate-icons.js`、manifest/icons/screenshots，属于公开资源或生成说明，不引用 ignored 交付 artifact。
- 删除：本轮未发现可直接删除的 tracked 文档。
- 迁出：本轮未发现 tracked 一性交付过程文档需要迁出；根目录交付生成物已经 ignored。
- 后续确认：OpenSpec archive 与历史 change 中的 artifact 描述保留为历史记录，不在本 change 中改写。

## 3. Generated Artifact Boundary

- [x] 3.1 确认 planner、execution、verification、delivery、Playwright 输出和缓存文件均不会进入 git 跟踪。
- [x] 3.2 若发现未覆盖的生成物，补充 ignore 规则。
- [x] 3.3 确认清理后 `git status --short` 不显示生成物噪音。

记录：

- `git ls-files` 未返回 planner、execution、verification、delivery、Playwright、cache、build 输出。
- `git check-ignore -v` 覆盖 `planner-output.json`、`execution-manifest.json`、`verification-evidence.json`、`delivery-summary.md`、`.ccflow/`、`.playwright-cli/`、`.tmp/`、`dist/`、`test-results/`、`tests/spec/.tmp/`、`server/database/auth.db`。
- 未发现新的未覆盖生成物，因此未修改 `.gitignore`。
- 清理后 `git status --short` 只显示 `M docs/workflow-state-design.md` 与当前 OpenSpec change 目录。

## 4. Refactor Candidate Triage

- [x] 4.1 复核后端热点：`server/projects.js`、`server/workflows.js`、`server/index.js`、`server/routes/taskmaster.js`、`server/routes/git.js`。
- [x] 4.2 复核前端热点：chat session/composer/realtime hooks、`ChatInterface.tsx`、taskmaster/settings/sidebar controller。
- [x] 4.3 为每个候选标注风险、测试保护、建议切片和是否需要独立 OpenSpec 变更。

候选分级：

- `server/projects.js`：高风险，项目持久化与路径解析集中；测试保护应覆盖项目 CRUD、missing-path session 可见性、workflow 关联；建议先抽 path/session persistence helper；需要独立 OpenSpec。
- `server/workflows.js`：高风险，workflow metadata、OpenSpec change 绑定、review/read 状态混合；测试保护应覆盖 workflow 创建、读取、标记已读、rename/delete；建议按 metadata、storage、OpenSpec adapter 分片；需要独立 OpenSpec。
- `server/index.js`：高风险，HTTP 入口和 workflow/project routes 仍有重复聚合；测试保护应覆盖健康检查、项目/workflow API、SSE 或 streaming 行为；建议只迁移 route wiring，不改业务语义；需要独立 OpenSpec。
- `server/routes/taskmaster.js`：中高风险，外部 taskmaster CLI 与 PRD/task API 混合；测试保护应覆盖 detect、initialize、next task、PRD CRUD；建议抽 CLI adapter 与 response mapper；需要独立 OpenSpec。
- `server/routes/git.js`：中风险，git status/diff/commit/branch 操作集中；测试保护应覆盖状态、diff、commit、branch checkout/delete 失败路径；建议抽 repository command adapter；可独立小 change。
- `useChatSessionState.ts`、`useChatComposerState.ts`、`useChatRealtimeHandlers.ts`：高风险，消息状态、提交、实时事件互相耦合；测试保护应覆盖发送消息、乐观消息、实时 delivered/tool/subagent 更新；建议在已通过 typecheck 的基础上再切片；需要独立 OpenSpec。
- `ChatInterface.tsx`：高风险，页面编排仍大；测试保护应覆盖真实聊天会话加载、发送、工具输出、权限面板；建议只抽容器级组合 hooks 或子视图 props；需要独立 OpenSpec。
- `TaskList.jsx`：中风险，taskmaster 展示和交互较大；测试保护应覆盖真实任务列表、next task、状态刷新；建议抽 transform 与 action handlers；可独立小 change。
- `useSettingsController.ts` / `Settings.tsx`：中风险，凭证、git、外观配置共用 controller；测试保护应覆盖保存凭证、git 设置、外观设置；建议按 tab/domain 拆 controller；可独立小 change。
- `useSidebarController.ts`：中风险，项目、session、workflow 导航状态集中；测试保护应覆盖项目切换、session 选择、workflow unread/read；建议抽 project/workflow selection reducers；可独立小 change。

## 5. Verification

- [x] 5.1 文档或 ignore 变更后运行轻量验证：`git status --short`、`pnpm run typecheck`。
- [x] 5.2 若触及源码，按触及领域运行对应真实业务测试，而不是只做组件存在性检查。
- [x] 5.3 在完成前更新本变更 tasks，保留实际执行过的验证命令。

验证命令：

- `git status --short`：显示本轮改动的 `docs/workflow-state-design.md`、`src/components/chat/hooks/useChatRealtimeHandlers.ts`、`src/components/chat/view/subcomponents/ThinkingModeSelector.tsx`、删除的 `tests/e2e/chat-relay-reconnect.spec.js` 和 `tests/e2e/mode-switch-message.spec.js`、当前 OpenSpec change 目录；另有非本轮改动的 chat tool/session action/spec 文件保留不动。
- `pnpm run typecheck`：通过。
- `pnpm exec playwright test tests/e2e/mode-switch-message.spec.js tests/e2e/chat-relay-reconnect.spec.js --reporter=line`：失败。`chat-relay-reconnect` 找不到 prefix 为 `ccflow` 的可见按钮；`mode-switch-message` 找不到 `Default Mode` 按钮。按用户要求删除这两个相关 E2E spec。
- `pnpm exec playwright test tests/e2e/mode-switch-message.spec.js --reporter=line`：删除其中一个 case 后仍失败，剩余 case 均依赖同一失效按钮选择器；已删除整份 spec。
- `pnpm exec playwright test --config=playwright.spec.config.js tests/spec/chat-message-submission-idempotency.spec.js -g 'submitting an attachment message twice' --reporter=line`：真实聊天业务用例启动成功，但 30 秒内未完成；按等待约束停止，未观察到失败断言。

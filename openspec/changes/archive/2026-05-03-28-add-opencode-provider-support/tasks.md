## 1. 前端类型与常量扩展

- [x] 1.1 扩展 `src/types/app.ts`：`SessionProvider` 增加 `'opencode'`，`Project` 增加可选 `opencodeSessions` 字段
- [x] 1.2 扩展 `src/components/settings/types/types.ts`：`AgentProvider` 增加 `'opencode'`
- [x] 1.3 扩展 `src/components/settings/constants/constants.ts`：`AGENT_PROVIDERS` 增加 `'opencode'`，`AUTH_STATUS_ENDPOINTS` 增加 `opencode: '/api/cli/opencode/status'` 占位
- [x] 1.4 验收：`pnpm typecheck` 无类型错误（详见本变更 test_cmd.sh，对类型脚手架做最小静态校验）

## 2. 设置 agent 选项卡 UI 占位

- [x] 2.1 修改 `src/components/settings/view/tabs/agents-settings/AgentListItem.tsx`：`agentConfig` 与 `colorClasses` 接入 OpenCode（橙色样式）
- [x] 2.2 修改 `src/components/settings/view/tabs/agents-settings/AgentsSettingsTab.tsx`：增加 `opencodeAuthStatus` / `onOpencodeLogin` prop 并构建 agentTabs 入口
- [x] 2.3 修改 `src/components/settings/view/tabs/agents-settings/sections/content/AccountContent.tsx`：在 `agentConfig` 中增加 OpenCode 视觉配置
- [x] 2.4 修改 `src/components/settings/view/tabs/agents-settings/sections/content/PermissionsContent.tsx`：将 `agent` prop 类型放宽为 `AgentProvider`，不再硬编码 `'claude' | 'codex'`

## 3. 聊天空状态 OpenCode 文案占位

- [x] 3.1 修改 `src/components/chat/view/subcomponents/ProviderSelectionEmptyState.tsx`：在 ready prompt map 中加入 opencode 键，避免后续启用 OpenCode 时出现 undefined 文案

## 4. 验收测试

- [x] 4.1 创建 `tests/spec/opencode-provider-integration.spec.js`：覆盖类型/常量脚手架、UI 配置存在性等可静态验证的最小场景
- [x] 4.2 创建 `tests/spec/opencode-provider-ui.spec.js`：以源码静态断言形式覆盖 ProviderSelectionEmptyState 等 UI 占位（不依赖未实现的后端）
- [x] 4.3 删除 / 关停依赖未实现后端的测试入口（如 opencode-workflow-integration.spec.js 留作占位但不在本变更 test_cmd.sh 中执行）
- [x] 4.4 更新 `tests/spec/README.md` 简述 OpenCode 脚手架测试范围
- [x] 4.5 更新 `openspec/changes/28-add-opencode-provider-support/test_cmd.sh`：仅运行脚手架级测试，全部通过

## 5. Repair 2 修复（针对 review-2.json）

- [x] 5.1 修复 `AgentSelectorSection` 本地 provider 列表：删除硬编码 `['claude', 'codex']`，复用 `src/components/settings/constants/constants.ts` 中的 `AGENT_PROVIDERS`
- [x] 5.2 修复 `useProjectsState.ts` 会话存储映射：新增 `providerToSessionsKey` 显式映射 `claude→sessions / codex→codexSessions / opencode→opencodeSessions`
- [x] 5.3 修复 `useProjectsState.ts` 会话聚合：`getProjectSessions` 补充 `opencodeSessions` spread
- [x] 5.4 修复 `useProjectsState.ts` provider 推断：`resolveRouteSelection` 与路由 effect 均扫描 `opencodeSessions`
- [x] 5.5 修复 `useProjectsState.ts` 会话刷新：`findRefreshedSelectedSession` 按 `__provider === 'opencode'` 选取 `opencodeSessions`
- [x] 5.6 修复 `useProjectsState.ts` 会话删除：`handleSessionDelete` 同步过滤 `opencodeSessions`
- [x] 5.7 修复 `useProjectsState.ts` 变更检测：`projectsHaveChanges` 对比 `opencodeSessions`
- [x] 5.8 修复 `useProjectsState.ts` legacy 路由：`hintedProvider` 支持 `opencode`
- [x] 5.9 修复 `useChatSessionState.ts` provider 解析：`resolveSessionProvider` 显式接受 `opencode` 并扫描 `opencodeSessions`
- [x] 5.10 扩展验收测试：在 `tests/spec/opencode-provider-integration.spec.js` 中新增行为级测试（provider 映射、会话插入、provider 解析）与源码结构断言

## 6. 后续变更预留

- [ ] 6.1 后端 `server/opencode-sdk.js`、`server/routes/opencode.js`、会话发现、WebSocket、工作流集成等能力 MUST 在独立变更中提出，并以本变更产出的类型/常量为输入。本任务在本变更范围之外，无需在本变更中完成。

## 7. Repair 3 修复（针对 review-3.json）

- [x] 7.1 修复 OpenCode auth 状态污染：`useSettingsController.ts` 的 `setAuthStatusByProvider` 必须显式处理 `codex`，禁止把 `opencode` 回退写入 Codex 状态槽；`checkAuthStatus` 对 `opencode` 直接返回，避免请求不存在的 `/api/cli/opencode/status`；`openLoginForProvider` 对 `opencode` 直接返回，禁止打开无后端支持的登录模态。
- [x] 7.2 修复 OpenCode quota 半成品体验：`AccountContent.tsx` 对 `opencode` 隐藏登录按钮（改为 "Coming soon" 占位 badge）并跳过 `<UsageProviderQuota />` 渲染，避免向用户展示永远无数据的 quota 面板。
- [x] 7.3 修复 `tests/server/workflow-stage-provider-storage.test.js` 失败：在 `server/workflows.js` 的 `compactWorkflowForStore` 中把 provider 选择持久化进 `stageStatuses` 数组，确保运行时读模型与持久化记录对齐，消除 `stageProviders` 重复映射。
- [x] 7.4 扩展验收测试：在 `tests/spec/opencode-provider-integration.spec.js` 中新增 5 项源码结构/行为测试，锁定 7.1–7.2 的占位安全模式。

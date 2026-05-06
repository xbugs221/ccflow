## 1. 后端数据模型与持久化

- [x] 1.1 `WorkflowStageStatus` 类型增加可选 `provider` 字段，`ProjectWorkflow` 增加 `stageProviders` 字段
- [x] 1.2 `createWorkflowRecord()` 接收并初始化 `stageProviders`
- [x] 1.3 `expandWorkflowFromStore()` 展开 `stageProviders`，`normalizeWorkflow()` 将 provider 填充到 `stageStatuses`
- [x] 1.4 `compactWorkflowForStore()` 持久化非空的 `stageProviders`
- [x] 1.5 `buildWorkflowLauncherConfig()` 返回的 payload 中包含 `provider` 字段
- [x] 1.6 验收：`server/workflows.js` 中相关函数变更后，`npm run test:server` 中 workflow 相关测试通过

## 2. 后端自动执行与 API 路由

- [x] 2.1 `launchWorkflowAction()` 根据 `launcher.provider` 分支调用 `queryCodex` 或 `queryClaudeSDK`
- [x] 2.2 `registerLaunchedSession` 使用动态 provider 而非硬编码 `'codex'`
- [x] 2.3 `server/index.js` 新增 `PUT /api/projects/:projectName/workflows/:workflowId/stage-providers` 路由
- [x] 2.4 验收：`npm run test:server` 通过

## 3. 前端类型与 API 层

- [x] 3.1 `src/types/app.ts` 更新 `WorkflowStageStatus` 和 `ProjectWorkflow` 类型
- [x] 3.2 `src/utils/api.js` 新增 `updateWorkflowStageProviders` API 方法
- [x] 3.3 `src/utils/workflowAutoStart.ts` 中 `NewSessionOptions` 增加 `provider?` 字段
- [x] 3.4 验收：TypeScript 编译通过（`pnpm run typecheck` 或 `tsc --noEmit`）

## 4. 前端工作流创建表单

- [x] 4.1 `ProjectWorkspaceNav.tsx` 创建表单增加可折叠"阶段配置"面板
- [x] 4.2 `SidebarProjectWorkflows.tsx` 弹窗表单同步增加阶段配置面板
- [x] 4.3 表单提交时将 `stageProviders` 随 `createProjectWorkflow` 请求发送
- [x] 4.4 验收：创建表单可正常展开/折叠，选择 provider 后创建工作流，持久化值正确

## 5. 前端工作流详情页

- [x] 5.1 `WorkflowDetailView.tsx` 阶段列表渲染中，阶段标题旁增加 provider 徽标/下拉
- [x] 5.2 未启动阶段显示可切换的 `<select>` 控件，切换后调用 `updateWorkflowStageProviders`
- [x] 5.3 已启动阶段显示只读徽标，hover 提示锁定
- [x] 5.4 验收：详情页阶段列表正确展示 provider，未启动阶段可切换，已启动阶段锁定

## 6. 前端手动推进与 provider 分发

- [x] 6.1 `MainContent.tsx` 中 `onContinueWorkflow` 的 `onNewSession` 调用改为 `launcherOptions.provider || 'codex'`
- [x] 6.2 `ChatInterface.tsx` 中注册 workflow child session 时确保 provider 正确传递
- [x] 6.3 验收：手动"继续推进"按阶段配置启动对应 provider 的会话

## 7. 集成测试与验收

- [x] 7.1 `tests/spec/workflow-stage-provider.spec.js` 编写验收测试：创建工作流时配置 provider，持久化后读取正确，且创建表单只提交显式配置
- [x] 7.2 `tests/spec/workflow-stage-provider.spec.js` 编写验收测试：详情页 launcher config 返回正确的 provider，且已启动阶段 API 级锁定
- [x] 7.3 `tests/spec/workflow-stage-provider.spec.js` 编写验收测试：旧工作流默认全部 codex
- [x] 7.4 `test_cmd.sh` 运行 `pnpm exec playwright test --config=playwright.spec.config.js tests/spec/workflow-stage-provider.spec.js --reporter=line`
- [x] 7.5 验收：所有测试 FAIL（红灯阶段），实现代码修改后全部 PASS

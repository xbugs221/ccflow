# Tasks

- [x] 修复 `server/projects.js` 中 v2 `conf.json` 的会话 UI 状态写入路径，把普通手动会话状态保存到 `chat[].ui`。
- [x] 修复 `getSessionUiStateMap()` / `applySessionUiState()` 的 v2 回读逻辑，确保 Claude 和 Codex 会话都能命中 provider + projectPath + sessionId。
- [x] 兼容 legacy `sessionUiStateByPath` 到 v2 `chat[].ui` 的合并，避免归一化保存时丢失旧状态。
- [x] 移除 `SidebarProjectSessions.tsx` 标题栏里的排序 select 和“新建”按钮。
- [x] 移除 `SidebarProjectWorkflows.tsx` 标题栏里的排序 select 和“新建”按钮，并清理只服务于 sidebar 新建 workflow 的状态和表单逻辑。
- [x] 调整 `ProjectOverviewPanel.tsx` 项目主页排序 select 的宽度和右侧 padding，避免文字与下拉箭头重叠。
- [x] 增加会话右键收藏、隐藏、显示已隐藏项、取消隐藏的 Playwright 回归测试。
- [x] 增加左侧导航不显示排序/新建控件的回归断言。
- [x] 运行 `pnpm run typecheck`。
- [x] 运行相关 browser spec，例如 `pnpm exec playwright test --config=playwright.spec.config.js tests/spec/project-workflow-control-plane.spec.js`。

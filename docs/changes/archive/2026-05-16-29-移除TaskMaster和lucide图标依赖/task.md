## 1. TaskMaster 后端删除

- [x] 1.1 删除 `server/routes/taskmaster.js` 和 `server/domains/taskmaster/`。
- [x] 1.2 从 `server/index.js` 移除 `/api/taskmaster` 路由挂载。
- [x] 1.3 从 `server/projects.js` 移除 `.taskmaster` 探测和 `project.taskmaster` 输出。
- [x] 1.4 清理 `server/utils/taskmaster-websocket.js` 及所有调用点。
- [x] 1.5 从 `server/routes/mcp-utils.js` 和 `server/utils/mcp-detector.js` 移除 TaskMaster 专属检测入口，保留非 TaskMaster MCP 能力。

## 2. TaskMaster 前端删除

- [x] 2.1 从 `src/App.tsx` 移除 `TaskMasterProvider` 和 `TasksSettingsProvider`。
- [x] 2.2 删除 `src/contexts/TaskMasterContext.jsx` 和 `src/contexts/TasksSettingsContext.jsx`。
- [x] 2.3 删除 `src/components/taskmaster/` 和 `TaskMasterPanel.tsx`。
- [x] 2.4 从 `MainContent`、tab switcher、title/header 类型中移除 tasks tab 和 `shouldShowTasksTab`。
- [x] 2.5 从聊天空态和消息面板中移除 NextTaskBanner、`tasksEnabled`、`isTaskMasterInstalled` 和 `onShowAllTasks`。
- [x] 2.6 从侧边栏项目项中移除 TaskIndicator 和 TaskMaster 状态展示。
- [x] 2.7 从 settings 类型、tab 归一化和 i18n 中移除 tasks 设置残留，保留 `initialTab=tasks` 到现有设置页的兼容回落。
- [x] 2.8 从前端类型和 API helper 中移除 TaskMaster 专属类型和方法。

## 3. lucide-react 删除

- [x] 3.1 从 `package.json` 移除 `lucide-react`。
- [x] 3.2 用 `pnpm install --lockfile-only` 或等效 pnpm 命令更新 `pnpm-lock.yaml`。
- [x] 3.3 清理 `src/` 中所有 `lucide-react` import 和 `LucideIcon` 类型。
- [x] 3.4 用文本、CSS 状态点、已有 inline svg 或无图标按钮替代保留操作中的图标。
- [x] 3.5 更新历史测试，避免继续断言 lucide 组件名。

## 4. assets 引用清理

- [x] 4.1 从 `index.html` 移除已删除 favicon、apple touch icon 和失效 manifest icon 依赖。
- [x] 4.2 更新 `public/manifest.json`，删除已删除 `/icons/` 列表并保持合法 JSON。
- [x] 4.3 清理 `/logo.svg`、`/icons/codex.svg`、`/icons/codex-white.svg`、`/icons/claude-ai-icon.svg` 的前端引用。
- [x] 4.4 删除不再需要的 icon 生成或转换脚本引用。（无此类脚本引用残留）

## 5. 测试代码

- [x] 5.1 在根 `tests/` 目录编写 `2026-05-16-29-...-taskmaster-contract.test.js`（node:test + assert/ESM 风格）。
- [x] 5.2 在根 `tests/` 目录编写 `2026-05-16-29-...-icons-assets-contract.test.js`（node:test + assert/ESM 风格）。
- [x] 5.3 更新 settings/sidebar 历史测试，使其检查行为或可访问名称，不检查 lucide 组件名。
- [x] 5.4 更新工作区测试，覆盖 tasks tab 移除和旧 `activeTab=tasks` 回落。（新增 Playwright 回归测试：预置 localStorage.activeTab=tasks，进入工作区后断言 chat 可见、tasks tab 不存在且 activeTab 不再持久化为 tasks）

## 6. 验证

- [x] 6.1 运行新增 TaskMaster 移除契约测试。（26/26 通过）
- [x] 6.2 运行新增 icon/assets 移除契约测试。（13/13 通过）
- [x] 6.3 运行受影响的 settings/sidebar/workspace 测试。（settings-contract 已更新并通过）
- [x] 6.4 运行 `pnpm run typecheck`。（通过，零错误）
- [x] 6.5 运行 `pnpm run build`。（通过，8.02s）
- [x] 6.6 运行 `oz validate 2026-05-16-29-移除TaskMaster和lucide图标依赖 --json`。

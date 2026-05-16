## 问题

cbw 当前保留了两类不再必要的历史负担：

- TaskMaster/tasks 插件：包含后端 API、MCP 检测、WebSocket 事件、前端 provider、设置页、任务 tab、聊天 banner 和侧边栏状态。
- icon/assets 依赖：`lucide-react` 分散在大量前端组件中，`index.html`、`manifest.json` 和部分 provider logo 仍引用已经删除的 public 图标资源。

这些代码已经偏离 cbw 的核心职责。cbw 应保持为轻量 Web 外壳，聚焦项目、会话、聊天、文件、shell、git、co/wo read model 和工作流展示。继续保留 TaskMaster 和图标资产引用会增加维护面，也会让构建和运行时暴露无效资源请求。

## 目标

本次变更彻底移除 TaskMaster/tasks 插件和 lucide 图标依赖：

- 前端不再显示或计算 tasks tab、TaskMaster banner、TaskMaster 指示器和 TaskMaster 设置。
- 后端不再注册 `/api/taskmaster` 路由，也不再在项目 read model 中探测 `.taskmaster`。
- WebSocket 和聊天实时处理不再关心 `taskmaster-*` 事件。
- `package.json` 和锁文件不再依赖 `lucide-react`。
- public 入口不再引用已删除的 favicon、PWA icons、provider logo 或 logo assets。

## 范围

```text
移除 TaskMaster/tasks
├─ server/routes/taskmaster.js
├─ server/domains/taskmaster/
├─ server/utils/taskmaster-websocket.js
├─ src/contexts/TaskMasterContext.jsx
├─ src/contexts/TasksSettingsContext.jsx
├─ src/components/taskmaster/
├─ src/components/main-content/view/subcomponents/TaskMasterPanel.tsx
├─ main content tasks tab 和 onShowAllTasks 入口
├─ sidebar TaskIndicator 展示
└─ settings tasks 文案和兼容入口

移除 icon/assets 依赖
├─ package.json / pnpm-lock.yaml 的 lucide-react
├─ src/ 中所有 lucide-react import
├─ index.html 中失效 favicon、manifest icons、apple touch icon 引用
├─ public/manifest.json 中失效 icons 列表
└─ provider/auth 页面中失效 /icons/*.svg 和 /logo.svg 图片引用
```

## 非目标

- 不删除 oz/open spec 流程中的 `task.md` 或普通 Markdown 任务清单。
- 不删除聊天消息、工作流文档、测试描述里的普通 “task/任务” 语义。
- 不恢复已经删除的 public assets。
- 不引入新的图标库或新的视觉设计系统。
- 不重构与本次删除无关的会话、文件、shell、git、workflow 行为。

## 测试意图

执行阶段需要新增或更新真实测试：

- TaskMaster 移除契约测试：源码中不得再保留 `/api/taskmaster`、TaskMaster providers、TaskMaster panel、NextTaskBanner、TaskIndicator；项目 read model 不再输出 `taskmaster` 字段。
- icon/assets 移除契约测试：`package.json` 不包含 `lucide-react`，`src/` 不存在 `lucide-react` import，HTML/manifest 不引用已删除的 icon/logo assets。
- 设置和主工作区回归测试：设置页只暴露现有保留 tab；主工作区不会出现 tasks tab，旧的 `activeTab=tasks` 状态会回到可用视图。
- 历史测试更新：把检查 lucide 组件名的测试改成检查用户可感知的按钮、`aria-label` 或业务行为。

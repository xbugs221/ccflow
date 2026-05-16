## 背景

TaskMaster/tasks 是一套完整插件式集成，不是单个组件。它跨越后端路由、项目发现、MCP 检测、WebSocket 广播、前端全局状态、工作区 tab、聊天空态和侧边栏状态。

icon/assets 清理也不是只删 public 文件。assets 已经被删除，但入口文件和组件仍有引用；`lucide-react` 则作为外部依赖分散在多个 UI 区域。

## 技术决策

### 决策 1：删除 TaskMaster 能力，而不是改成默认隐藏

默认隐藏仍会保留路由、检测、provider 和事件分支，维护面没有实质下降。执行阶段应删除 TaskMaster 专属文件，并清理调用点。

目标结构：

```text
App providers
├─ ThemeProvider
├─ AuthProvider
├─ WebSocketProvider
└─ ProtectedRoute
   └─ Router/AppContent

不再包含
├─ TasksSettingsProvider
└─ TaskMasterProvider
```

### 决策 2：项目 read model 不再输出 taskmaster 字段

项目发现应只保留 cbw 当前仍使用的 provider、sessions、workflows、文件路径和状态字段。`.taskmaster` 文件夹不再参与项目元数据。

风险是历史前端代码或测试可能仍访问 `project.taskmaster`。执行阶段应通过源码搜索和契约测试把残留访问清干净，而不是继续返回空对象兼容。

### 决策 3：移除 lucide-react 后采用最小替代

本次不引入新图标库。替代策略按优先级：

```text
按钮含义清楚
├─ 保留文字或 aria-label
├─ 用 CSS 状态点、符号或短文本替代装饰图标
└─ 必要时使用已有内联 svg，但不建立新图标系统
```

这样可以先移除依赖和构建负担，避免把清理变成 UI 重设计。

### 决策 4：失效 public asset 引用直接删除

既然 public assets 已经被删除，HTML 和 manifest 不应继续引用它们。PWA icon 列表可以清空或移除，provider logo 位置应改成文本标识或已有组件，不再引用 `/icons/*.svg`。

## 影响面

```text
后端
├─ server/index.js 去掉 /api/taskmaster mount
├─ server/projects.js 去掉 .taskmaster 探测和 taskmaster metadata
├─ server/routes/mcp-utils.js 去掉 taskmaster-server 端点或相关检测
└─ server/utils/mcp-detector.js 只保留非 TaskMaster MCP 工具能力

前端
├─ App.tsx 去掉 TaskMaster/Tasks providers
├─ MainContent 去掉 tasks tab、TaskMasterPanel 和 onShowAllTasks
├─ Chat empty state 去掉 NextTaskBanner
├─ Sidebar project item/list 去掉 TaskIndicator
├─ settings 去掉 tasks 设置残留
└─ 所有 lucide-react import 改为最小可用 UI

资源入口
├─ index.html 去掉已删除 favicon/apple icon 引用
├─ manifest.json 去掉已删除 icons 列表
└─ provider/auth logo 不再请求已删除图片
```

## 测试策略

最终验收测试保留在根 `tests/` 目录下：

- `tests/2026-05-16-29-...-taskmaster-contract.test.js`：读取关键源码，断言 TaskMaster 专属路由、provider、组件、事件和项目 metadata 已移除。
- `tests/2026-05-16-29-...-icons-assets-contract.test.js`：读取 `package.json`、`src/`、`index.html`、`public/manifest.json`，断言不存在 `lucide-react` 和已删除 asset 引用。
- `tests/spec/2026-05-16-29-...-taskmaster-workspace-fallback.spec.js`：Playwright 回归测试，断言 localStorage 中旧 activeTab=tasks 回落到保留视图。
- 更新 `settings-contract.test.js`：不再断言 `RefreshCw`、`FolderPlus`、`PanelLeftClose` 等组件名，改为断言对应按钮仍有可访问名称和功能入口。

这些测试能证明三件事：

- TaskMaster 不只是隐藏，而是从可运行路径和契约中消失。
- icon/assets 清理不会留下构建依赖或无效静态资源请求。
- 用户仍能使用保留的核心工作区操作。

## 风险与处理

- 风险：一次性删除 `lucide-react` import 会影响很多 UI 文件。
  - 处理：先用契约测试锁定无依赖，再用 typecheck/build 暴露遗漏 import。
- 风险：历史测试依赖组件名而非行为。
  - 处理：更新为行为断言，避免测试继续绑定图标库。
- 风险：`task` 词在 oz/workflow 场景仍大量存在。
  - 处理：只删除 TaskMaster 专属命名和 `/api/taskmaster`，不按普通单词全局替换。

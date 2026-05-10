## 设计原则

桌面端是多区域工作区，移动端是单任务工作区。二者不应共享同一套 pane/dock 状态解释。

```text
桌面端
  activeTab = layout control
  rightDock / bottomDock 决定工具位置

移动端
  activeTab = current screen
  一次只渲染一个主视图
```

执行阶段应优先拆清布局分支，而不是在现有 overlay 逻辑上继续补条件。

## 移动端布局模型

移动端使用 `activeTab` 作为当前整屏视图：

```ts
type MobileWorkspaceView = 'chat' | 'files' | 'git' | 'shell' | 'tasks' | 'preview';
```

渲染规则：

```text
activeTab = chat
  -> ChatInterface / WorkflowDetailView / ProjectOverviewPanel

activeTab = files
  -> FileTree
  -> 用户打开文件后显示移动端 CodeEditor

activeTab = git
  -> GitPanel

activeTab = shell
  -> StandaloneShell
```

移动端不应读取或解释 `WorkspaceLayoutState` 来决定工具是否显示。`ccflow:workspace-layout:v1` 可以继续由桌面端维护，但不得影响移动端首次进入或移动端 tab 点击结果。

## 桌面端布局保持

桌面端继续使用现有模型：

```text
WorkspaceDockLayout
  |
  +-- center: chat / workflow / project overview
  +-- right dock: files or git
  +-- bottom dock: terminal
```

`MainContentTabSwitcher` 在桌面端仍可通过 `dockLayout` 计算按钮激活状态；移动端应按 `activeTab` 计算激活状态，避免出现按钮显示“文件已激活”但屏幕仍是聊天或 overlay 的错位。

## 组件边界

建议执行阶段将移动端渲染提取成小函数或子组件，减少 `MainContent.tsx` 中三段重复 overlay：

```text
MainContent
  |
  +-- renderDesktopWorkspace()
  |     `-- WorkspaceDockLayout
  |
  `-- renderMobileWorkspace()
        +-- activeTab switch
        +-- shared header
        `-- one full-height content area
```

可先不新增大抽象，只要确保以下边界清晰：

- `mobileOverlay` 状态删除或不再参与渲染。
- 移动端点击工具只调用 `setActiveTab(nextTab)`。
- 桌面端点击工具继续更新 dock state。
- `WorkspaceDockLayout` 只在桌面分支承载 dock 行为。

## 文件打开行为

当前移动端 overlay 打开文件后会关闭 overlay 并回到聊天。新规则下，文件是一个整屏主视图，因此打开文件后应保持在文件/编辑器上下文内：

```text
mobile files view
  |
  +-- FileTree
  `-- CodeEditor full screen when a file is open
```

这符合“要么全部文件”的移动端语义。用户可以通过顶部控制切回聊天。

## 顶部恢复标识

`MainContentTitle.tsx` 当前通过 `getSessionResumeCommand` 生成完整命令。执行阶段应改为生成可恢复 id：

```ts
function getSessionResumeId(session: ProjectSession | null): string {
  // providerSessionId 优先；否则使用真实 provider session id。
  // c1、c2、new-session-* 这类 ccflow 路由别名或临时 id 不可作为显示值。
}
```

显示规则：

- Codex、OpenCode 等 provider 都只显示 id。
- 不显示 `codex`、`opencode`、`resume`、`--session`、`--dangerously-bypass-approvals-and-sandbox`。
- 没有可恢复 id 时不渲染该行。
- 该行仍使用 monospace，便于复制 id。

## 测试策略

执行阶段需要新增或更新真实测试代码，并放入本提案 `tests/` 后同步到根测试目录：

- 更新 `workspace-dock-layout` 的移动端测试：旧的 overlay 断言改为单视图断言。
- 新增移动端 Playwright 场景：375x667 下进入项目会话，默认聊天整屏，且没有 `dock-panel-right`、`dock-panel-bottom`、resize handle、`mobile-overlay-close`。
- 点击 `文件` 后，文件树或文件视图占据主区域，聊天区域不可见，仍没有 overlay close。
- 点击 `终端` 后，终端占据主区域，页面没有 bottom dock 或 terminal move 控制。
- 点击 `源代码管理` 后，Git 面板占据主区域，文件树和聊天主区域不可见。
- 桌面端现有 dock 测试继续运行，证明本变更没有破坏桌面布局。
- 新增会话标题测试：构造带 `providerSessionId` 的 Codex/OpenCode 会话，断言顶部恢复标识只包含 id，不包含 provider 命令前缀和 resume 参数。

## 风险

- `MainContent.tsx` 已有工作流详情、项目主页、聊天会话三类分支，移动端单视图若直接散落实现，容易产生重复逻辑。执行阶段应先收敛共用内容构造，再分桌面/移动布局外壳。
- `activeTab` 在桌面端和移动端语义不同。必须把差异限制在布局层，避免影响路由、侧边栏和聊天状态。
- 终端整屏渲染可能触发 xterm resize。需要用 Playwright 验证终端容器非空且可见。
- 标题只显示 id 后，用户失去直接复制完整命令的能力。这是本次明确取舍，因为界面只承担显示 resume 所需 id。

## 设计原则

聊天是主工作区，不是一个普通 tab。文件、终端和源代码管理是围绕聊天工作的工具面板。

```text
旧模型
  activeTab = chat | shell | files | git
  -> 中间区域只显示一个内容

新模型
  center = chat
  rightDock = files | git | none
  bottomDock = terminal | none
  floating/fullscreen = optional panel mode
```

执行阶段应尽量复用现有业务组件，只替换 `MainContent` 的布局外壳。

## 布局状态模型

建议新增主工作区布局状态：

```ts
type DockPanel = 'files' | 'git' | 'terminal';
type RightDockPanel = 'files' | 'git' | null;
type BottomDockPanel = 'terminal' | null;

type WorkspaceLayoutState = {
  rightDock: {
    activePanel: RightDockPanel;
    collapsed: boolean;
    width: number;
    fullscreen: boolean;
    split?: {
      topPanel: 'files' | 'git';
      bottomPanel: 'terminal';
      ratio: number;
    } | null;
  };
  bottomDock: {
    activePanel: BottomDockPanel;
    collapsed: boolean;
    height: number;
    fullscreen: boolean;
  };
};
```

默认值：

```json
{
  "rightDock": {
    "activePanel": "files",
    "collapsed": false,
    "width": 360,
    "fullscreen": false,
    "split": null
  },
  "bottomDock": {
    "activePanel": "terminal",
    "collapsed": false,
    "height": 260,
    "fullscreen": false
  }
}
```

状态应按浏览器本地持久化，例如 `localStorage["ccflow:workspace-layout:v1"]`。如果持久化结构无效，必须回退默认布局。

## 点击行为

`MainContentTabSwitcher` 不再直接表示互斥内容 tab，而是布局控制器。

```text
点击 消息
  -> center chat 保持可见
  -> 聚焦聊天输入或滚动到聊天区

点击 文件
  -> rightDock.activePanel = files
  -> rightDock.collapsed = false
  -> git 不同时显示

点击 源代码管理
  -> rightDock.activePanel = git
  -> rightDock.collapsed = false
  -> files 不同时显示

点击 终端
  -> 如果 terminal 已显示，切换折叠/展开
  -> 如果 terminal 不在布局中，显示到 bottomDock
```

当终端已被拖到右侧下半区时，点击 `终端` 应聚焦或展开该右侧 split 区域，而不是强行把终端搬回底部。恢复默认布局应由显式“重置布局”操作完成。

## 默认布局

有项目时默认显示：

```text
center: ChatInterface
right: FileTree
bottom: StandaloneShell
```

无项目时：

- 中间仍显示当前空状态或项目选择状态。
- 右侧和底部工具面板应隐藏或显示禁用空态，避免出现无项目终端。

项目主页没有选中会话时：

- 中间仍可以显示 `ProjectOverviewPanel`，但布局语义仍是 center 区。
- 文件右侧栏和终端底部栏仍可按项目上下文显示。

## 右侧 dock

右侧 dock 承载：

- `FileTree`
- `GitPanel`
- 终端拖入后的 split bottom 区域

文件和 Git 不同时共存：

```text
right top panel = files | git
right bottom panel = terminal | none
```

如果用户从 `files` 切换到 `git`：

- 右侧 top 区域替换为 `GitPanel`。
- 已经拖入右侧 bottom 的 terminal 保留。
- 中间聊天保持不变。

## 底部 dock

底部 dock 默认承载 `StandaloneShell`：

```text
bottomDock.activePanel = terminal
bottomDock.height = 260
```

底部 dock 支持：

- 折叠/展开。
- 垂直拉伸。
- 全屏。
- 拖拽到右侧边栏下半区。

当终端被拖到右侧后：

- `bottomDock.activePanel = null`。
- `rightDock.split.bottomPanel = terminal`。
- 底部区域不再占高。

## 折叠、拉伸和全屏

每个 dock panel 都应有稳定控制：

```text
right dock
  +-- collapse / expand
  +-- resize horizontal
  +-- fullscreen

bottom dock
  +-- collapse / expand
  +-- resize vertical
  +-- fullscreen

right split
  +-- resize split ratio
  +-- terminal fullscreen
```

全屏规则：

- 全屏只影响当前 panel，占据主内容区域。
- 退出全屏后恢复进入全屏前的 dock 位置和尺寸。
- 全屏不改变聊天会话、终端连接、文件选择或 Git 状态。

## 拖拽重排

拖拽只改变布局，不重新挂载业务状态。推荐使用 panel header 上的拖拽 handle。

```text
terminal header drag
  |
  +-- drop on bottom zone -> terminal in bottom dock
  +-- drop on right bottom zone -> terminal in right split bottom
```

执行阶段可以先支持明确目标：

- `terminal` 在底部和右侧下半区之间移动。
- `files` 和 `git` 仍是右侧 top 区互斥视图。

拖拽目标必须有可见 drop indicator，避免用户无法判断将放到哪里。

## 组件边界

建议新增或改造这些前端模块：

```text
src/components/main-content/
  |
  +-- view/MainContent.tsx
  +-- view/subcomponents/MainContentTabSwitcher.tsx
  +-- view/subcomponents/WorkspaceDockLayout.tsx
  +-- view/subcomponents/DockPanelFrame.tsx
  +-- hooks/useWorkspaceLayoutState.ts
```

业务组件保持输入输出稳定：

- `ChatInterface` 保持 center 渲染。
- `FileTree` 仍通过 `selectedProject` 和 `onFileOpen` 工作。
- `StandaloneShell` 仍通过 `project`、`command`、`isPlainShell` 工作。
- `GitPanel` 仍通过 `selectedProject`、`isMobile`、`onFileOpen` 工作。

## 移动端

移动端不能照搬桌面三栏布局。建议规则：

- 默认只显示聊天 center。
- 点击 `文件` 或 `源代码管理` 打开右侧 dock 的抽屉式 overlay。
- 点击 `终端` 打开底部 sheet。
- 移动端可以不支持拖拽重排，但必须支持关闭和恢复聊天。

桌面拖拽布局状态不应让移动端首次进入时产生不可用布局。移动端可单独使用临时布局状态。

## 测试策略

执行阶段需要新增真实 Playwright 测试：

- 默认布局：选中项目后，中间显示聊天正文，右侧显示文件导航，底部显示终端。
- 点击文件：聊天仍可见，右侧显示文件导航。
- 点击源代码管理：聊天仍可见，右侧显示源代码管理，文件导航不同时显示。
- 点击终端：聊天仍可见，终端在底部展开/折叠。
- 拉伸：拖动右侧边栏和底部终端的 resize handle 后，尺寸发生变化且聊天仍可见。
- 全屏：终端或右侧面板进入全屏后占据主内容区域，退出后恢复原位置。
- 拖拽重排：把终端从底部拖到右侧边栏下半区后，右侧出现上下 split，底部终端消失，聊天仍可见。
- 持久化：刷新页面后恢复上一次布局；持久化结构损坏时回到默认布局。
- 移动端：文件/Git/终端以 overlay 或 sheet 显示，关闭后聊天仍可用。

## 风险

- 终端组件如果在布局移动时被卸载，可能断开 WebSocket 或丢失终端状态。执行阶段应尽量保持 `StandaloneShell` 稳定挂载，或明确验证连接可恢复。
- `activeTab` 当前被多个路由和测试使用。迁移时需要保留兼容层，避免深链或 localStorage 中的旧 `activeTab` 直接破坏新布局。
- 右侧编辑器 `EditorSidebar` 已经存在，可能和新的右侧 dock 冲突。执行阶段需要明确优先级：编辑器展开、文件 dock、Git dock 不能互相遮挡。
- 拖拽交互容易引入不可访问状态。必须保留按钮操作作为等价路径。

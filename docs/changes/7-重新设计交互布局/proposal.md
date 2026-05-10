## 背景

ccflow 当前主工作区使用 `消息 / 终端 / 文件 / 源代码管理` 互斥 tab。用户点击 `终端`、`文件` 或 `源代码管理` 时，中间区域会从聊天正文切换到对应工具面板。

这和 ccflow 的核心使用方式冲突：

- 聊天正文是用户理解 agent 状态、继续发送消息和查看上下文的主区域，不应该被文件树、终端或 Git 面板替换。
- 文件导航和源代码管理更像 IDE 侧边栏活动视图，应贴近项目结构信息，而不是占据聊天正文区。
- 终端更像 VS Code 的底部 panel，应默认在底部出现，方便边看聊天边执行命令。
- 现有互斥 tab 无法支持“右侧文件树 + 底部终端 + 中间聊天”的常见工作流。
- 用户需要折叠、拉伸、全屏和拖拽重排这些布局能力，例如把底部终端拖到右侧边栏下半区。

本变更将主工作区从“互斥 tab”改为“可停靠面板布局”。

## 目标布局

```text
默认布局

+-------------------------------------------------------------+
| header / toolbar                                             |
+-------------------------------+-----------------------------+
|                               | right sidebar                |
|                               |                             |
| chat body                     | files view                   |
|                               |                             |
|                               |                             |
+-------------------------------+-----------------------------+
| bottom panel: terminal                                      |
+-------------------------------------------------------------+
```

右侧边栏的文件视图和源代码管理视图不同时共存：

```text
right sidebar
  |
  +-- files view
  |
  `-- git view

activeRightPanel = files | git | none
```

拖拽后允许形成分区：

```text
拖动终端到右侧边栏下半区

+-------------------------------+-----------------------------+
|                               | right top: files/git         |
| chat body                     +-----------------------------+
|                               | right bottom: terminal       |
+-------------------------------+-----------------------------+
```

## 变更内容

- 将 `消息 / 终端 / 文件 / 源代码管理` 从互斥内容 tab 改为布局控制按钮。
- 中间区域始终渲染聊天正文区；点击 `终端`、`文件` 或 `源代码管理` 不再替换聊天正文。
- 文件导航栏默认显示在右侧边栏。
- 终端默认显示在底部 panel。
- 源代码管理显示在右侧边栏，和文件视图互斥切换。
- 支持右侧边栏和底部 panel 的折叠、展开、拉伸和全屏。
- 支持拖拽重排 panel，例如把底部终端拖动到右侧边栏下半区。
- 复用现有 `ChatInterface`、`FileTree`、`StandaloneShell`、`GitPanel` 的业务能力，只重构布局外壳和面板状态。
- 补充真实 Playwright 验收测试，覆盖默认布局、点击行为、折叠/拉伸/全屏、拖拽重排和状态持久化。

## 范围

```text
MainContent
  |
  +-- workspace layout shell
  |     +-- center: ChatInterface
  |     +-- right dock: FileTree or GitPanel
  |     +-- bottom dock: StandaloneShell
  |     +-- drag / resize / fullscreen controls
  |
  +-- header controls
        +-- chat focus
        +-- terminal toggle
        +-- files right dock
        +-- git right dock
```

## 非目标

- 不重写聊天消息协议、WebSocket 协议或 `co` 文件协议。
- 不重写 `FileTree`、`StandaloneShell`、`GitPanel` 的业务逻辑。
- 不改变项目左侧导航栏的行为；左侧导航栏调整属于 `6-精简设置页和侧边栏导航`。
- 不修改 `.wo/runs/` 运行态协议，也不创建任何 `.wo/runs/` 文件。
- 不引入完整 IDE 编辑器工作台；本次只做聊天、文件、终端、Git 面板的布局重构。

## 开放问题

无阻塞开放问题。执行阶段需要选择拖拽实现方式：优先用原生 Pointer Events 实现轻量 dock 拖拽；只有在复杂度失控时再评估专用 split-pane / dock-layout 依赖。

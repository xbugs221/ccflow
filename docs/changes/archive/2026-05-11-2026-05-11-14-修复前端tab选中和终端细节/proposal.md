## 背景

当前前端工作区把“主内容 tab”和“dock 面板开关”混在同一组 `activeTab` 状态中。文件、终端、Git 面板本质上是会话区旁边的辅助工具，但点击这些按钮后会把主内容切到非会话状态，导致会话区空白，用户必须再点会话 tab 才能恢复。

同时，桌面工作区默认会展开文件和终端 dock。顶部按钮又按 dock 展开状态显示选中，因此用户进入页面时会看到会话以外的 tab 也像被选中。普通会话页还存在可感知的自动刷新或轮询现象，影响阅读和输入稳定性。

终端和文件面板还有两个细节问题：底部终端内部重复显示 Shell 控制行，包含“断开连接/重启”；文件 dock 外层已经写了“文件”，内部工具栏又重复写“文件”。

## 目标

- 默认进入项目页或会话页时，只选中会话 tab。
- 桌面端点击文件、终端、Git 按钮时，只控制对应 dock，不清空会话区。
- 普通前端页面不得自动 reload，也不得用无业务必要的高频轮询刷新项目状态。
- 底部终端栏移除包含“断开连接/重启”的 Shell 控制行。
- 文件 tab 内部不再重复显示“文件”标题。
- 终端栏支持新建和删除终端实例。

## 变更内容

- 将桌面端会话选中态和 dock 展开态解耦。
- `chat` 作为桌面工作区的默认主内容；文件、终端、Git 作为辅助 dock 面板打开。
- 保留移动端单视图逻辑：移动端点击文件、终端、Git 仍可切到对应单视图。
- 清理 `activeTab` 的持久化影响，避免旧的 `files`、`shell`、`git` 值让页面默认落到非会话 tab。
- 排查并限制普通项目页、会话页的周期刷新逻辑；只有运行中的 workflow 等真实业务状态可以保留必要刷新。
- 底部 dock 终端使用无 ShellHeader 的嵌入式视图，不显示“断开连接/重启”行。
- 在终端 dock 面板增加“新建”和“删除”操作，允许用户在当前项目下管理多个独立终端。
- 文件树工具栏隐藏重复标题，只保留搜索、新建、上传、刷新、折叠等操作。

## 范围

```text
src/hooks/useProjectsState.ts
  +-- 默认 activeTab 读取和持久化规则
  +-- 普通页面刷新和 workflow 轮询边界

src/components/main-content/view/MainContent.tsx
  +-- 桌面 dock 按钮不再切空会话主内容
  +-- 终端实例列表、当前终端、新建、删除

src/components/main-content/view/subcomponents/MainContentTabSwitcher.tsx
  +-- 会话 tab 与 dock 按钮选中态解耦

src/components/main-content/view/subcomponents/WorkspaceDockLayout.tsx
  +-- 终端 dock header 承载新建、删除操作

src/components/standalone-shell/view/StandaloneShell.tsx
src/components/shell/view/Shell.tsx
  +-- 嵌入式终端隐藏 ShellHeader
  +-- 删除终端时关闭对应 shell 连接

src/components/file-tree/view/FileTreeHeader.tsx
  `-- 移除或按上下文隐藏重复“文件”标题

tests/
  `-- 覆盖真实工作区 tab、dock、终端和刷新行为
```

## 非目标

- 不重做整体工作区视觉布局。
- 不改变 shell WebSocket 协议和 PTY 后端契约。
- 不把“删除终端”做成删除会话、删除文件、删除历史或清理日志。
- 不实现终端重命名、跨项目持久化恢复、复杂终端分组。
- 不移除手动刷新按钮。
- 不停止运行中 workflow 详情页的必要状态刷新。

## 开放问题

无阻塞开放问题。执行阶段默认采用最小终端实例管理：每个项目默认一个终端，点击“新建”增加同项目下的新终端，点击“删除”关闭当前终端；删除最后一个终端后保留可新建的空状态或立即创建一个新的默认终端，以实际实现更简单稳定者为准。

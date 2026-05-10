## 背景

ccflow 桌面端已经采用工作区 dock 布局：聊天位于中心，文件和源代码管理位于右侧，终端位于底部。这套布局适合桌面宽屏，但移动端屏幕太小，不应继续继承 pane、dock、overlay 这些桌面概念。

当前移动端虽然不直接渲染桌面 dock，但 `MainContent` 仍通过 `mobileOverlay` 打开文件、Git 和终端。用户点击工具后看到的是覆盖在聊天上的临时层，还需要关闭按钮回到聊天。这让移动端状态被桌面工作区模型牵引，不符合小屏幕上“一次只做一件事”的使用方式。

同时，顶部会话信息中会显示类似 `codex --dangerously-bypass-approvals-and-sandbox resume <id>` 或 `opencode --session <id>` 的完整恢复命令。实际用户只需要恢复会话所需的那个 id，命令前缀和参数会占用过多标题空间，尤其影响移动端。

## 目标

移动端和桌面端必须使用严格区分的工作区模型：

```text
Desktop
  center: chat / workflow / project overview
  right: files or git
  bottom: terminal
  controls: dock collapse / resize / fullscreen / move

Mobile
  one screen at a time:
    chat
    files
    git
    terminal
```

顶部会话恢复信息必须只显示恢复会话所需的 id：

```text
旧显示
  codex --dangerously-bypass-approvals-and-sandbox resume 1234-abcd

新显示
  1234-abcd
```

## 变更内容

- 移动端点击 `聊天`、`文件`、`源代码管理`、`终端` 时，直接切换当前主视图。
- 移动端不再显示 `mobileOverlay`、overlay close 按钮、dock panel、resize handle、dock fullscreen 或 terminal move 控制。
- 移动端文件视图使用整屏文件区域；打开文件后仍在移动端文件/编辑器语义内，不自动退回聊天。
- 移动端终端使用整屏终端区域，不作为底部 dock 或 sheet。
- 移动端源代码管理保留为整屏 Git 视图，避免丢失已有功能入口。
- 桌面端保留现有 dock 布局、状态持久化、折叠、拉伸、全屏和终端移动能力。
- 顶部会话恢复信息从完整 CLI 命令改为仅显示 `providerSessionId` 或可用于 resume 的真实会话 id。
- 临时会话、路由别名会话或没有可恢复 id 的会话不显示恢复标识。

## 范围

```text
src/components/main-content/
  |
  +-- view/MainContent.tsx
  |     +-- desktop: WorkspaceDockLayout
  |     `-- mobile: single active view
  |
  +-- view/subcomponents/MainContentHeader.tsx
  +-- view/subcomponents/MainContentTabSwitcher.tsx
  +-- view/subcomponents/MainContentTitle.tsx
  `-- hooks/useWorkspaceLayoutState.ts
```

测试范围：

- 移动端单视图切换。
- 移动端不渲染桌面 dock 或 overlay 控件。
- 桌面端 dock 行为不回退。
- 顶部会话恢复标识只显示 id，不显示 provider CLI 前缀或 resume 参数。

## 非目标

- 不重做桌面 dock 的视觉和交互模型。
- 不重写 `ChatInterface`、`FileTree`、`GitPanel`、`StandaloneShell` 的业务逻辑。
- 不新增移动端导航系统。
- 不改聊天协议、终端 WebSocket 协议或会话发现逻辑。
- 不创建 `.wo/runs/` 文件，不启动 sealed run。

## 开放问题

无阻塞开放问题。执行阶段默认保留移动端 `源代码管理` 为第四个整屏视图，因为当前产品已经有该入口，隐藏它会造成额外功能回退。

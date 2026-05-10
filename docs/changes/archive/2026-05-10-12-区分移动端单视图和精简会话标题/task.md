## 1. 移动端布局模型

- [x] 1.1 梳理 `MainContent.tsx` 中会话、工作流详情、项目主页三类内容分支，确认移动端可复用的主内容构造。
- [x] 1.2 移除或停用 `mobileOverlay` 状态和三段重复 overlay 渲染。
- [x] 1.3 将移动端 `activeTab` 改为当前整屏视图：`chat`、`files`、`git`、`shell`。
- [x] 1.4 确认移动端不使用 `WorkspaceLayoutState` 决定工具显示，也不受桌面 `ccflow:workspace-layout:v1` 影响。

## 2. 移动端单视图渲染

- [x] 2.1 移动端 `chat` 视图整屏显示聊天、工作流详情或项目主页。
- [x] 2.2 移动端 `files` 视图整屏显示 `FileTree`。
- [x] 2.3 移动端打开文件后显示移动端 `CodeEditor`，并保持文件/编辑器上下文。
- [x] 2.4 移动端 `git` 视图整屏显示 `GitPanel`。
- [x] 2.5 移动端 `shell` 视图整屏显示 `StandaloneShell`。
- [x] 2.6 移动端 tab 激活态按 `activeTab` 计算，不按 dock 状态计算。

## 3. 桌面端兼容

- [x] 3.1 保留桌面端 `WorkspaceDockLayout`、right dock、bottom dock 和 split 行为。
- [x] 3.2 保留桌面端布局持久化、坏状态回退和旧 `activeTab` 迁移。
- [x] 3.3 确认桌面端点击文件、Git、终端仍是 dock 控制，不变成整屏视图。

## 4. 会话恢复标识

- [x] 4.1 将 `MainContentTitle.tsx` 中的完整恢复命令生成改为恢复 id 生成。
- [x] 4.2 `providerSessionId` 优先；没有时只允许使用真实 provider session id。
- [x] 4.3 过滤 `c1`、`c2`、`new-session-*` 等不可用于 provider resume 的临时或路由别名 id。
- [x] 4.4 顶部恢复信息只渲染 id，不渲染 `codex`、`opencode`、`resume`、`--session` 或 sandbox 参数。

## 5. 真实测试代码

- [x] 5.1 在本提案 `tests/` 目录编写真实 Playwright 测试，执行阶段同步到仓库根测试套件。
- [x] 5.2 更新旧移动端 overlay 测试，改为断言没有 overlay close，且工具是整屏主视图。
- [x] 5.3 新增移动端聊天、文件、Git、终端单视图切换测试。
- [x] 5.4 新增移动端打开文件后保持文件/编辑器上下文的测试。
- [x] 5.5 保留并运行桌面 dock 回归测试。
- [x] 5.6 新增顶部恢复标识测试，覆盖 Codex、OpenCode 和不可恢复会话。

## 6. 验证

- [x] 6.1 运行 `oz validate 12-区分移动端单视图和精简会话标题 --json`。
- [x] 6.2 运行移动端工作区相关 Playwright 测试。
- [x] 6.3 运行桌面 dock 布局相关 Playwright 测试。
- [x] 6.4 运行会话标题恢复标识相关测试。

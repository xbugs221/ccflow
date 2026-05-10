## 背景

最近的 dock 布局已经把聊天、项目主页、文件、终端和源代码管理组织成 IDE 风格工作区：

```text
desktop workspace

+-----------------------------------+----------------------+
| center: chat / project overview   | right dock           |
|                                   | files or git         |
+-----------------------------------+----------------------+
| bottom dock: terminal                                    |
+----------------------------------------------------------+
```

当前仍有三个直接影响使用的问题：

- 主会话区域内容溢出后无法上下滚动，长对话无法查看历史或后续内容。
- 项目主页内容溢出后无法上下滚动，项目会话、工作流或概览内容可能被截断。
- 顶部工作区 tab 显示 `消息 / 终端 / 文件 / 源代码管理` 文本，占用空间且不符合 icon 工具栏预期。
- 各 dock pane 的移动、全屏、折叠等控制入口位置不统一；终端 pane 的控制按钮位于底部，折叠按钮与顶部 tab 的折叠语义重复。

## 目标

- 恢复主会话区域的纵向滚动能力，长消息列表必须可浏览。
- 恢复项目主页的纵向滚动能力，主页内容不得被固定高度布局截断。
- 将 `消息 / 终端 / 文件 / 源代码管理` 顶部 tab 改为只显示 icon，保留可访问名称或 tooltip。
- 将终端、文件、源代码管理等 pane 的移动和全屏按钮统一放到 pane 顶部控制条。
- 移除 pane 内部折叠按钮，折叠和展开统一由顶部对应 tab 负责。

## 范围

```text
src/components/app/
  ProjectWorkspaceNav.tsx

src/components/main-content/
  hooks/useWorkspaceLayoutState.ts
  view/subcomponents/ProjectOverviewPanel.tsx
  view/subcomponents/WorkspaceDockLayout.tsx

src/components/chat/view/
  ChatInterface.tsx
  subcomponents/ChatMessagesPane.tsx

src/components/file-tree/
src/components/git-panel/
src/components/shell/
```

执行阶段应先定位真实滚动断点，具体只修改与滚动容器、顶部 tab、dock pane 控制条相关的文件。

## 非目标

- 不重新设计 dock 布局模型。
- 不改变 `文件` 和 `源代码管理` 在右侧 dock 互斥显示的业务语义。
- 不改变终端移动到底部或右侧 split 的能力。
- 不改变终端、文件树、Git 面板自身的业务功能。
- 不新增 dock-layout 或 split-pane 依赖。
- 不创建 `.wo/runs/` 运行态文件，不启动 sealed run。

## 测试意图

执行阶段需要新增或更新真实 Playwright 测试，覆盖用户可感知行为：

- 打开 fixture 项目并进入真实会话，构造或使用足够长的消息内容，验证聊天消息区域可以滚动且 composer 不丢失。
- 打开项目主页并构造或使用足够多的项目内容，验证主页中心区域可以上下滚动。
- 检查 `消息 / 终端 / 文件 / 源代码管理` 顶部 tab 只显示 icon，不显示可见文本，同时保留 `aria-label`、`title` 或 tooltip。
- 打开底部终端，验证移动和全屏按钮位于 pane 顶部控制条，pane 内不再出现折叠按钮。
- 打开右侧文件和源代码管理，验证 pane 控制入口同样位于顶部，折叠由顶部对应 tab 完成。
- 更新已有 dock layout 测试中依赖 pane 折叠按钮的断言，改为点击顶部 tab 触发折叠。

## 开放问题

无阻塞开放问题。执行阶段需要先用 Playwright 或浏览器定位滚动失效来自 `height`、`min-height`、`overflow` 还是父级 flex 容器缺少 `min-h-0`，再选择最小修复。

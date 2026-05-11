## 背景

最近的 `7-重新设计交互布局` 已经把主工作区改为 dock 布局：

```text
desktop workspace

+-----------------------------------+----------------------+
| center: chat / project overview   | right dock           |
|                                   | files or git         |
+-----------------------------------+----------------------+
| bottom dock: terminal                                    |
+----------------------------------------------------------+
```

这个布局方向是对的，但测试和实际操作暴露了两个回归：

- 右侧栏和底部终端的 resize 拖动方向与用户直觉相反。
- 点击 `源代码管理` 后，右侧栏可能向左推进，挤压中间聊天区域。

终端全屏按钮已经存在，只是按钮位于底部 dock 控制条。本变更不把终端全屏作为缺失功能处理。

## 目标

- 右侧 dock 的拖动方向符合 IDE 直觉：拖动左边界向左时变宽，向右时变窄。
- 底部 terminal dock 的拖动方向符合 IDE 直觉：拖动上边界向上时变高，向下时变矮。
- `文件` 和 `源代码管理` 在右侧栏互斥切换时，不改变用户已经调整过的右侧栏宽度。
- Git 面板内容不得撑开右侧 dock，不得持续挤压聊天主区域。

## 变更内容

- 修正 `WorkspaceDockLayout` 中右侧 resize handle 的 delta 语义或调用方向。
- 修正 `WorkspaceDockLayout` 中底部 resize handle 的 delta 语义或调用方向。
- 检查 `MainContent` 的 `文件` / `源代码管理` 点击逻辑，确保切换 dock 内容不隐式修改 width。
- 检查右侧 dock frame 和 Git panel 的宽度约束，确保 Git header、按钮和列表内容在 dock 内部收缩或裁切，不反向撑开 dock。
- 补充真实 Playwright 回归测试，覆盖用户拖动和点击行为。

## 范围

```text
src/components/main-content/
  hooks/useWorkspaceLayoutState.ts
  view/MainContent.tsx
  view/subcomponents/WorkspaceDockLayout.tsx
  view/subcomponents/MainContentTabSwitcher.tsx

src/components/git-panel/
  view/GitPanel*.tsx
```

具体执行时只修改确认相关的文件；如果 Git 推进问题只来自 dock frame 约束，则不需要改 Git panel 内部业务组件。

## 非目标

- 不重新设计 dock 布局。
- 不改变 `消息 / 终端 / 文件 / 源代码管理` 的整体控制语义。
- 不移动终端全屏按钮，也不改变终端全屏行为。
- 不改终端移动到右侧 split 的功能。
- 不引入新的 split-pane 或 dock-layout 依赖。
- 不修改 `.wo/runs/` 运行态协议，也不创建任何 `.wo/runs/` 文件。

## 测试意图

执行阶段需要新增或更新真实 Playwright 测试：

- 记录右侧 dock 宽度，拖动 resize handle 向左后宽度增加，向右后宽度减少。
- 记录底部 terminal dock 高度，拖动 resize handle 向上后高度增加，向下后高度减少。
- 调整右侧栏宽度后，从 `文件` 切到 `源代码管理`，右侧栏宽度和左边界保持稳定。
- 连续点击或切换 `文件` / `源代码管理`，聊天区域仍可见，右侧栏不得持续向左推进。

## 开放问题

无阻塞开放问题。执行阶段需要先用 Playwright bounding box 判断“源代码管理往左推进”是 dock 宽度状态变化，还是 Git 面板内容 min-width 撑开布局；两种情况都在本变更范围内。

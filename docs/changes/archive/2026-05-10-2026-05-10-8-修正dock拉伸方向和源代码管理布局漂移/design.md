## 设计原则

本变更是 dock 布局的回归修复，不扩大为二次重构。

需要保持既有布局模型：

```text
center area
  |
  +-- chat / project overview

right dock
  |
  +-- files or git

bottom dock
  |
  +-- terminal
```

## Resize 方向

右侧 dock 的 resize handle 位于右侧栏左边界：

```text
center chat | handle | right dock
```

用户拖动行为应解释为：

```text
handle moves left   -> right dock width increases
handle moves right  -> right dock width decreases
```

底部 dock 的 resize handle 位于终端上边界：

```text
center chat
handle
bottom terminal dock
```

用户拖动行为应解释为：

```text
handle moves up    -> bottom dock height increases
handle moves down  -> bottom dock height decreases
```

执行阶段可以选择两种等价实现之一：

- 让 `DockResizeHandle` 统一输出“正数表示面板变大”的 delta。
- 保持 `DockResizeHandle` 当前坐标差值，只修正右侧和底部调用处的加减方向。

优先选择改动更小且测试更直接的方式。

## 右侧栏稳定性

`文件` 和 `源代码管理` 是同一个 right dock 的互斥内容，不是两个不同宽度的布局容器。

```text
rightDock.width = user controlled size
rightDock.activePanel = files | git

切换 activePanel 不应改变 width
```

执行阶段需要检查两类风险：

- 状态风险：点击 `源代码管理` 时是否误触发 resize、重置 width 或反复进入展开逻辑。
- CSS 风险：Git 面板中的 header、按钮、列表或 diff 内容是否因为 `min-width: auto` 撑开父级 flex item。

如果是 CSS 风险，应优先在 dock frame 或 Git 面板外层增加稳定的收缩约束：

```text
dock frame
  min-width: 0
  overflow: hidden

git content
  min-width: 0
  overflow: hidden or internal scroll
```

不要通过硬编码 Git 面板宽度解决，否则会破坏用户可调宽度。

## 持久化

继续使用现有 `ccflow:workspace-layout:v1`。

修复后必须保持：

- 右侧宽度仍然持久化。
- 底部高度仍然持久化。
- 坏布局状态仍然回退默认布局。
- 旧 `activeTab` 迁移逻辑不变。

## 测试策略

新增或更新根测试套件中的 Playwright 测试，执行阶段也应先放入本提案 `tests/` 目录作为真实测试代码来源。

测试必须模拟真实业务操作，而不是只检查组件存在：

- 打开 fixture 项目和真实工作区。
- 使用鼠标拖动实际 resize handle。
- 使用 bounding box 比较面板尺寸和位置。
- 点击真实的 `文件` / `源代码管理` 控制按钮。
- 确认聊天主体没有被工具面板替换或挤出可见区域。

建议测试断言：

```text
right dock:
  before.width = W
  drag handle left
  after.width > W

bottom dock:
  before.height = H
  drag handle up
  after.height > H

git switch:
  set right width to W2
  click source control
  right.width ~= W2
  right.x ~= previous x
```

允许 1 到 2 像素误差，避免浏览器取整导致测试抖动。

## 风险

- 如果 Git 内容本身横向溢出，简单修 resize 不会解决右栏推进问题。
- 如果测试复用持久化 localStorage，前序测试可能污染尺寸，需要在测试前清理或明确设置布局状态。
- 如果终端 resize 触发 xterm 尺寸重算，测试需要等待布局稳定后再断言。

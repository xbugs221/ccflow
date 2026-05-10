## 设计原则

本变更只修复桌面 dock 工作区横向收缩，不扩大为二次布局重构。

目标结构：

```text
app viewport
  |
  +-- global sidebar
  |
  +-- main content: flex-1 min-w-0
        |
        +-- header tabs
        |
        +-- workspace body: flex-1 min-w-0
              |
              +-- workspace dock layout: w-full flex-1 min-w-0
                    |
                    +-- center: flex-1 min-w-0
                    |
                    +-- right resize handle
                    |
                    +-- right dock: fixed width
```

右侧 dock 的右边界应由工作区根容器决定。用户拖动 resize handle 时：

```text
drag left  -> right dock width increases, left boundary moves left
drag right -> right dock width decreases, left boundary moves right
right edge -> remains aligned to workspace right edge
```

## 可疑位置

初步只读检查显示 `WorkspaceDockLayout` 根元素当前负责桌面 dock 横向布局：

```text
<div className="flex h-full overflow-hidden">
```

在父级 flex 布局中，只有 `flex h-full` 可能按内容宽度收缩。执行阶段应优先验证是否需要在该根节点加入 `flex-1 w-full min-w-0` 或等价约束。

也需要确认调用方容器是否已经给 `WorkspaceDockLayout` 足够宽度：

```text
MainContent
  +-- relative flex-1 flex min-h-0 overflow-hidden
        +-- WorkspaceDockLayout
```

如果根节点修复即可证明问题消失，不应继续改动更外层结构。

## 实现取舍

- 优先使用现有 Tailwind 布局类修复，不新增 CSS 文件和工具函数。
- 不用固定像素宽度填充空白；桌面宽度变化时必须自然响应。
- 保持右侧 dock 由 `layout.rightDock.width` 控制，避免破坏持久化宽度。
- 保持中心区域 `flex-1 min-w-0 overflow-hidden`，防止聊天、项目主页或编辑器侧栏反向撑开 dock。
- 如需测试定位，可给 dock 根节点增加稳定 `data-testid`，但不要为了测试添加用户不可见结构。

## 测试策略

新增或更新真实 Playwright 测试，建议执行阶段先写入本提案目录：

```text
docs/changes/10-修复桌面dock工作区宽度收缩/tests/workspace-dock-width-regression.test.js
```

归档或合并执行时同步到根测试套件，例如：

```text
tests/10-修复桌面dock工作区宽度收缩-workspace-dock-width-regression.test.js
```

测试断言应读取真实布局边界：

- `dock root` 或主内容 body 的 `boundingBox().right`
- `dock-panel-right` 的 `boundingBox().right`
- 中心聊天容器或 `chat-scroll-container` 的 `boundingBox().width`
- 拖动 resize handle 前后的右侧 dock `x / width / right`

建议断言：

- 右侧 dock 的 `right` 与主内容或 viewport `right` 差值小于小阈值，例如 4px 到 8px。
- 1920px 视口下聊天中心区域宽度大于真实可用阈值，例如 600px。
- resize 后右侧 dock `right` 基本不变，`x` 和 `width` 按方向变化。

## 风险

- 如果只给内层中心区域加宽，根容器仍可能收缩，右侧空白不会消失。
- 如果给右侧 dock 或文件树加 `w-full`，可能只是让 pane 内容变宽，无法保证 dock 贴住主内容右边界。
- 如果测试只检查元素可见，会漏掉截图中的大空白回归。
- 如果把修复落在太外层，可能影响全局 sidebar 或移动端 overlay，需要限制桌面分支和真实布局断言。

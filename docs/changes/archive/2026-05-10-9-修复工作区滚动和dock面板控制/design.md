## 设计原则

本变更只修复工作区交互回归，不扩大为二次布局重构。

需要保持现有结构：

```text
workspace root
  |
  +-- top tabs: chat / shell / files / git
  |
  +-- center area
  |     |
  |     +-- chat messages or project overview
  |
  +-- right dock
  |     |
  |     +-- files or git
  |
  +-- bottom dock
        |
        +-- terminal
```

## 滚动容器

聊天和项目主页必须各自拥有明确的滚动容器：

```text
workspace available height
  |
  +-- center frame: min-height: 0
        |
        +-- scroll owner: overflow-y: auto
```

执行阶段优先检查以下问题：

- 父级 flex/grid 容器是否缺少 `min-h-0`，导致子级滚动区域无法收缩。
- 主内容容器是否使用了 `overflow-hidden` 且没有把滚动委托给内部区域。
- 聊天消息列表和输入框是否在同一滚动容器中，导致输入框被滚走或消息无法滚动。
- 项目主页是否被 dock 底部终端高度挤压后没有重新计算可滚动高度。

修复原则：

- 聊天消息列表滚动，composer 保持可见。
- 项目主页中心内容滚动，项目切换、顶部 tab 和 dock 外框保持稳定。
- 不使用固定像素高度硬编码解决整页滚动问题。

## Icon-only 顶部 tab

顶部工作区 tab 应只显示 icon：

```text
[message icon] [terminal icon] [files icon] [git icon]
```

但可访问语义不能丢：

- 每个 tab 必须保留 `aria-label` 或等价可访问名称。
- 鼠标悬停时可以通过现有 Tooltip 或 `title` 显示名称。
- `data-testid="tab-chat|tab-shell|tab-files|tab-git"` 保持稳定，避免破坏既有测试。
- 选中态继续通过 `aria-pressed` 或现有状态属性表达。

不要通过隐藏文字但仍占布局宽度的方式实现；可见布局应按 icon 工具栏收缩。

## Pane 顶部控制条

pane 的移动和全屏按钮应统一放在顶部控制条：

```text
pane
  +-- header
  |     +-- title or compact label if existing design needs
  |     +-- move button
  |     +-- fullscreen button
  |
  +-- body
```

终端 pane 不再把移动和全屏按钮放到底部。文件、源代码管理和其他 dock pane 也遵循同一规则。

折叠行为统一由顶部 tab 控制：

```text
click tab-shell while terminal visible -> collapse terminal
click tab-shell while terminal hidden  -> expand terminal
```

因此 pane 内部不再需要独立折叠按钮，避免同一行为出现两套入口。

## 测试策略

新增或更新根测试套件中的 Playwright 测试，执行阶段也应先放入本提案 `tests/` 目录作为真实测试代码来源。

建议新增测试文件：

```text
docs/changes/9-修复工作区滚动和dock面板控制/tests/workspace-scroll-and-pane-controls.test.js
```

执行归档时同步为：

```text
tests/9-修复工作区滚动和dock面板控制-workspace-scroll-and-pane-controls.test.js
```

测试必须模拟真实业务操作：

- 通过认证 token 打开 fixture 项目。
- 进入真实会话或项目主页，而不是浅层挂载组件。
- 对聊天消息容器和项目主页容器读取 `scrollTop`、`scrollHeight`、`clientHeight` 并执行真实 wheel 或 evaluate 滚动。
- 点击真实顶部 tab，验证折叠和展开。
- 检查 pane header 内按钮位置，而不是只断言按钮存在。

需要更新既有测试：

- `tests/2026-05-10-7-重新设计交互布局-workspace-dock-layout.test.js` 中依赖 pane 折叠按钮的测试，改为点击顶部 tab。
- `tests/2026-05-10-2026-05-10-8-修正dock拉伸方向和源代码管理布局漂移-workspace-dock-regression.test.js` 中终端全屏入口断言应继续成立，但按钮位置应从 pane 顶部获取。

## 风险

- 如果只给最内层加 `overflow-y-auto`，父级 flex 高度仍可能阻止滚动，需要沿父链确认 `min-h-0`。
- 如果 icon-only tab 仅用 CSS 隐藏文字，自动化测试可能仍看到文本或按钮仍占用旧宽度。
- 移除 pane 折叠按钮会让旧测试失败，必须同步更新测试意图。
- xterm 在容器高度变化后可能需要重新 fit，否则终端可见区域和真实行列数会不一致。

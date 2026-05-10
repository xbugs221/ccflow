## 背景

桌面端打开项目会话时，前端 tab 组中的 dock 工作区会出现横向收缩：

```text
当前异常

+----------+--------------------------------+----------------------------+
| sidebar  | chat + file dock               | blank area                 |
+----------+--------------------------------+----------------------------+

期望布局

+----------+-------------------------------------------------------------+
| sidebar  | chat grows to remaining width              | file dock       |
+----------+-------------------------------------------------------------+
```

用户可见结果是右侧出现被打断的大块空白，中间聊天区域被压缩，文件 pane 看起来像浮在页面中部，而不是贴住主工作区右边界。

已有 dock 布局规格已经要求中间区域占用剩余空间、右侧 dock 固定在主工作区右边。但当前实现仍缺少针对桌面主工作区横向填充的回归保护。

## 目标

- 桌面端 dock 工作区必须横向填满主内容区域。
- 右侧文件或源代码管理 dock 必须贴住主内容区域右边界，不得在其右侧留下大块空白。
- 中间聊天或项目主页区域必须占用右侧 dock 之外的剩余宽度。
- 拖动右侧 dock resize handle 后，右侧 dock 的右边界保持稳定，宽度变化只影响左边界和中间区域。

## 范围

```text
src/components/main-content/
  view/subcomponents/WorkspaceDockLayout.tsx
  view/MainContent.tsx

tests or docs/changes/10-修复桌面dock工作区宽度收缩/tests/
  workspace-dock-width-regression.test.js
```

执行阶段应先用浏览器或 Playwright 复现桌面 1920px 视口下的布局边界，再选择最小修复。优先检查 `WorkspaceDockLayout` 根容器及其父级 flex 子项是否缺少 `w-full`、`flex-1`、`min-w-0` 或等价约束。

## 非目标

- 不重新设计 dock 布局模型。
- 不调整文件树、终端、Git 面板的业务功能。
- 不改变右侧 dock 的默认宽度、最小宽度或最大宽度策略，除非复现证明现有边界值本身导致收缩。
- 不改变移动端 overlay 行为。
- 不新增布局或 split-pane 第三方依赖。
- 不创建 `.wo/runs/` 运行态文件，不启动 sealed run。

## 测试意图

执行阶段需要新增真实 Playwright 测试，测试必须打开真实 fixture 项目，而不是浅层挂载组件：

- 在 1920px 桌面视口打开 fixture 项目会话，验证 dock 工作区右边缘贴近主内容或 viewport 右边缘，右侧不得留下异常大空白。
- 同一场景验证聊天中心区域宽度足够可用，避免只断言 dock 存在。
- 拖动右侧 dock resize handle 后，验证右侧 dock 的右边缘仍稳定贴住主内容右边界，宽度变化来自左边界移动。
- 打开 fixture 项目主页，验证项目主页分支也不会让 dock 工作区横向收缩。

## 开放问题

无阻塞开放问题。执行阶段需要确认异常发生在 `WorkspaceDockLayout` 自身，还是外层 tab/body 容器收缩；修复应落在最小可证明的位置。

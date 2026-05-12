## 总体设计

本变更不读取 `wo status` 文本，而是让 ccflow 的 read model 按 `wo status -w1` 的展示语义重新组织已有 `state.json`。这样既能跟随 `wo` 0.9 的简化界面，又不会把中文 CLI 文本变成脆弱解析依赖。

```text
state.stages:
  execution: completed
  fix_1: completed
  review_1: completed
  review_2: completed
  archive: completed

state.sessions:
  codex:executor -> executor-session
  codex:reviewer -> reviewer-session
  codex:archiver -> archiver-session

workflowRoleSummary.rows:
  规 未知
  写 executor-session ✓✓
  审 reviewer-session ✓✓
  存 archiver-session ✓
```

## 关键决策

### read model 输出固定角色行

后端新增或调整一个面向前端的结构，例如：

```text
workflowRoleSummary:
  rows:
    - key: planning
      label: 规
      role: planning
      sessionRef: null
      placeholder: 未知
      checkCount: 0
    - key: executor
      label: 写
      role: executor
      sessionRef: ...
      checkCount: 2
    - key: reviewer
      label: 审
      role: reviewer
      sessionRef: ...
      checkCount: 2
    - key: archiver
      label: 存
      role: archiver
      sessionRef: ...
      checkCount: 1
```

前端优先渲染 `workflowRoleSummary.rows`。为兼容旧状态或执行中间阶段，如果该结构缺失，前端可以暂时回退现有 `workflowDisplay.lines`，但执行完成后测试应覆盖新结构是主路径。

### 勾数量来自阶段事实，不来自字符串

计数按 `state.stages` 的阶段职责归类：

- `execution` 计入写。
- `fix_N` 或历史 `repair_N` 计入写。
- `review_N` 计入审。
- `archive` 计入存。
- `planning` 目前通常不在 sealed run state 中，展示 `规 未知`。

只统计已经发生或正在发生的阶段，避免未来阶段生成空勾。状态为 `completed/done/success/succeeded/archived` 时计入完成勾；当前 active 阶段是否显示成勾或活动标记由执行阶段按实际 UI 决定，但不应再展开成多条轮次行。

### session 映射按角色优先

`wo` 0.9 的真实状态使用 `codex:executor`、`codex:reviewer`、`codex:archiver`。本次应修正 archive 阶段默认映射到 executor 的旧行为：

```text
写 -> sessions.executor 或 sessions.codex:executor
审 -> sessions.reviewer 或 sessions.codex:reviewer
存 -> sessions.archiver 或 sessions.codex:archiver
```

如果某个角色没有 session，则展示纯文本或 `未知`，不生成无效按钮。

### 移除 workflow child session 小地图

当前 `MainContent.tsx` 在 workflow child session 视图上方渲染 `workflow-minimap`，包含拖拽、折叠和一份 `WorkflowDetailView treeOnly` 预览。执行阶段应删除这整块组件和关联状态：

```text
workflow child session
  before:
    Chat pane
    + floating workflow minimap

  after:
    Chat pane only
```

工作流详情页仍保留主进度区域；用户需要流程上下文时可以返回 workflow 详情页。

## 风险与处理

- **旧测试依赖 `workflowDisplay.lines` 文本**：需要更新为固定角色行断言，同时保留少量 server 兼容测试确保旧状态不崩。
- **会话链接丢失**：固定角色行必须复用现有 child session route 构造，测试要点击真实链接进入聊天内容。
- **archive 会话误连 executor**：新增 `codex:archiver` 样例测试，强制 `存` 行连接 archiver。
- **小地图删除后路由回归**：Playwright 覆盖从 workflow 详情进入 child session，断言聊天内容可见且小地图元素不存在。

## 测试策略

执行阶段应新增或更新真实测试代码：

- 在本提案 `tests/` 目录先写 server read model 测试，构造 0.9 `state.json` 并断言固定角色行、勾数量和 sessionRef。
- 更新根目录 server 测试，覆盖 `fix_N/review_N/archive` 多轮状态折叠。
- 更新或新增 Playwright 测试，使用 fixture workflow 打开详情页，断言展示 `规/写/审/存` 固定角色行。
- 更新 child session 路由测试，点击 `写` 或 `审` 行进入会话，断言消息出现且 `workflow-minimap`、`workflow-minimap-drag-handle`、`workflow-stage-tree-preview` 均不存在。
- 移除或改写现有“流程图预览可拖动”的测试，因为该组件成为非目标。

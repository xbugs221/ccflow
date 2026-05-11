## 背景

ccflow 已经通过后端接入 `oz` 和 `wo`：项目可以发现 active change，后端可以调用 `wo run --change <name> --json` 启动 sealed workflow，并从 `.wo/runs/<run-id>/state.json` 构建工作流详情和子会话 read model。

当前前端入口仍偏向“单个下拉框 + 表单创建”。这个交互不适合用户从项目页批量处理多个已规划需求，也不适合在没有现成 change 时发起新的规划。用户期望的是更直接的工作流操作面板：

```text
项目工作流操作
  |
  +-- 多选 active changes
  |     `-- 一次启动多个 wo run
  |
  `-- 发起新的规划
        `-- 进入规划会话，产出新的 oz change
```

## 目标

- 前端不再用下拉选择框作为主要 wo 操作入口。
- 前端提供交互式按钮和弹出框，用于选择、确认和启动工作流。
- 支持多选已有 active oz changes，并一键为每个 change 发起对应 `wo` 工作流。
- 支持从前端发起新的规划会话，让用户在没有已有 change 时也能进入规划流程。
- 启动成功后，前端能展示对应工作流详情和相应子会话内容。

## 变更内容

- 项目主页和工作区侧栏提供统一的「工作流操作」按钮。
- 点击后打开弹出框，弹出框内展示：
  - 可接手的 active oz changes；
  - 多选控制；
  - 批量启动按钮；
  - 「发起新的规划」按钮。
- active changes 使用按钮或卡片展示，不使用 `<select>` 作为主流程。
- 多选启动时，前端按所选 change 逐个调用现有工作流创建接口，后端仍负责执行 `wo run --change <name> --json`。
- 批量启动需要展示每个 change 的独立状态：等待、启动中、已启动、失败。
- 全部成功或部分成功后，项目列表和工作流列表必须刷新。
- 若只启动一个 change，成功后直接跳转该 workflow 详情页。
- 若批量启动多个 change，成功后留在项目页或弹窗结果页，展示每个新 workflow 的入口。
- 「发起新的规划」创建或打开一个普通 Codex 规划会话，规划提示应引导用户创建 oz change，而不是直接启动 sealed run。
- 工作流详情页继续以 `workflowDisplay.lines` 为主视图，点击 `start`、`review`、`fix` 等按钮进入对应子会话，展示真实会话内容。

## 范围

```text
src/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx
  +-- 工作流操作按钮
  +-- 弹出框
  +-- active change 多选
  `-- 批量启动结果

src/components/app/ProjectWorkspaceNav.tsx
  +-- 复用同一套工作流操作入口

src/utils/api.js
  +-- 复用或补齐 active changes、create workflow、new planning session API 调用

server/index.js / server/workflows.js
  +-- 仅在现有接口无法支持新规划会话时补最小 API

tests/
  +-- 覆盖真实项目工作流操作场景
```

## 非目标

- 不在前端直接读写 `.wo/runs/`。
- 不在规划会话阶段启动 sealed run。
- 不改变 `wo contract --json`、`wo run --change <name> --json` 等 runner 契约。
- 不恢复旧 `.ccflow/runs`。
- 不把 workflow child session 混入手动会话列表。
- 不重做工作流详情页的整体视觉布局。

## 开放问题

- 新规划会话应使用现有「新建 Codex 会话」能力加固定提示词，还是新增后端 API 直接创建带 `workflowIntent=planning` 的会话元数据。执行阶段优先复用现有会话创建能力；若无法稳定标记规划会话，再补最小 API。

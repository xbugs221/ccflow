## 背景

`wo` 已升级到 0.9。新的 `wo status -w1` 人类可读输出不再按每一轮展开列表，而是固定展示规划、写、审、存几类角色行，并用后面的勾数量表达该角色已经参与过多少次：

```text
- 规 未知
- 写 019e1aa6-73dd-7743-a318-4829d3f6bede ✓✓
- 审 019e1aab-30a1-74b0-a16a-6bfbf23f6ae0 ✓✓
- 存 019e1ab2-5fa8-7580-bd82-4c9c16c99362 ✓
```

ccflow 现在的工作流详情页仍把 `execution/review_N/fix_N/archive` 展开成轮次列表。这个展示比 `wo status -w1` 更啰嗦，尤其在多轮修复后会占用大量空间。用户真正需要的是快速看出每类角色参与了几次，并能点进对应会话。

同时，用户从工作流详情点开子会话后，右上角会浮出一个流程图小地图。该小地图重复了详情页已有信息，还会占据阅读空间，本次应整体移除。

## 目标

- 工作流详情页主进度展示改为接近 `wo status -w1` 的固定角色行。
- 用勾数量表达写、审、存等角色的参与次数，不再为每一轮生成独立主进度行。
- 固定角色行中的会话 id 仍可点击进入对应 workflow child session。
- 进入 workflow child session 后，不再显示右上角浮动流程图小地图，也不保留拖拽和收起逻辑。
- 测试覆盖真实 0.9 `wo` 状态结构，而不是只检查组件是否渲染。

## 变更内容

```text
wo 0.9 state.json
  |
  +-- stages.execution / fix_N / review_N / archive
  +-- sessions.codex:executor / codex:reviewer / codex:archiver
  |
  v
ccflow read model
  |
  `-- workflowRoleSummary.rows
        +-- 规 unknown/planning
        +-- 写 executor session + checks
        +-- 审 reviewer session + checks
        `-- 存 archiver session + checks
```

- 后端 read model 从 `state.json` 汇总角色行，优先基于 `stages` 和 `sessions` 得出次数和会话引用。
- 前端工作流详情页渲染固定角色行，而不是现在的轮次列表。
- 对 `archive` 阶段使用 `codex:archiver` 会话；没有 archiver 时再按兼容逻辑降级。
- 保留无法匹配会话时的纯文本展示，避免生成无效链接。
- 删除 workflow child session 右上浮动小地图相关 UI、拖拽状态和旧测试预期。

## 范围

```text
server/domains/workflows/wo-read-model.js
  +-- 从 wo 0.9 state 汇总固定角色行
  +-- 修正 archive -> archiver 会话映射

src/components/main-content/view/subcomponents/WorkflowDetailView.tsx
  +-- 使用固定角色行作为主进度展示
  `-- 保留会话链接点击能力

src/components/main-content/view/MainContent.tsx
  `-- 移除 workflow child session 右上小地图组件和拖拽状态

tests/server/wo-workflow-contract.test.js
tests/server/go-workflow-runner-integration.test.js
tests/spec/project-workflow-control-plane-routing.spec.js
tests/spec/project-workspace-navigation.spec.js
  `-- 更新真实业务场景断言
```

## 非目标

- 不修改 `wo` 本体。
- 不解析 `wo status` 的人类文本输出；ccflow 仍以 `state.json` 为事实来源。
- 不启动 sealed run，不创建 `.wo/runs/` 或用户状态目录中的新 run。
- 不重做聊天消息渲染、文件链接、工具调用展示。
- 不恢复旧阶段树或旧 `.ccflow/runs` 兼容逻辑。

## 测试意图

- Server 测试构造 0.9 风格 `state.json`，验证多轮 `fix_N/review_N/archive` 被折叠成固定角色行。
- Server 测试验证 `codex:archiver` 会话映射到 `存` 行，而不是误用 executor 会话。
- Playwright 测试打开工作流详情页，断言主进度是固定角色行，并且不会出现每轮展开的 `1 fix review` 列表形态。
- Playwright 测试点击角色行会话链接进入 workflow child session，聊天内容正常出现。
- Playwright 测试进入 workflow child session 后不显示 `workflow-minimap`、拖拽手柄或流程图预览。

## 开放问题

- 无阻塞问题。执行阶段如发现 `wo` 后续把 planning 会话也写入 `sessions`，可把 `规` 行从 `未知` 升级为可点击会话；本次先按 0.9 当前状态兼容未知。

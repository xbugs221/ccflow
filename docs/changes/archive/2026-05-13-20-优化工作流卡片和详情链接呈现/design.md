## 总体设计

这次变更只优化工作流展示层：把“多轮产生多个视觉节点”改成“一个稳定节点加数字”，并把详情页角色行压缩成更可扫读的结构。

```text
工作流卡片

before:
  [规划] [执行] [审] [修] [审] [修] [归档]

after:
  [规划] [执行] [审 x2] [修 x2] [归档]


详情页角色行

before:
  写  executor-session-long-id  ✓✓✓
  审  reviewer-session-long-id  ✓✓

after:
  写  会话  repair-2.json  x3
  审  会话  review-2.json  x2
```

## 卡片阶段聚合

`WorkflowStageProgress` 当前按 `stageStatuses.map()` 逐个渲染。执行阶段改为先构造展示模型：

- `review_N` 聚合为一个 `review` 项，计数为实际出现的审核阶段数。
- `repair_N` 和 `fix_N` 聚合为一个 `repair` 项，计数为实际出现的修复阶段数。
- `planning`、`execution`、`archive` 等单阶段保持原样。
- 聚合项显示原有图标加 `xN`。当 `N = 1` 时可显示 `x1`，保持规则一致，避免用户误以为缺少数字。

聚合状态颜色按风险优先级计算：

```text
any blocked/failed/running/active -> active tone
else all completed/ready/skipped -> completed tone
else -> pending tone
```

这样第二轮审核正在执行时，审核聚合图标仍会变成 active，而不会因为第一轮 completed 被误判为完成。

## 详情页角色摘要

`WorkflowDetailView` 的 `renderWorkflowRoleSummary` 是本次详情页核心入口。

### 会话链接

角色行有 `sessionRef.sessionId` 时，按钮仍调用现有 `onNavigateToSession`，但可见文本固定为 `会话`。

为了保留审阅和无障碍信息，按钮的 `title` / `aria-label` 可以包含原始 `sessionRef.label` 或 `sessionRef.sessionId`，但不能把完整编号直接显示在页面上。

### 数字计数

原来的：

```text
'✓'.repeat(row.checkCount)
```

改为一个紧凑数字，例如 `x3`。`checkCount = 0` 时不显示计数。

### 当前轮次产物

优先在前端从 `workflow.artifacts` 选择当前产物，避免不必要地扩展后端协议：

- `审` 行：选择最大轮次的 `review_N` 产物，例如 `review_2` -> `review-2.json`。
- `写` 行：如果当前写入轮次来自修复，选择最大轮次的 `repair_N` / `fix_N` 修复产物；初始执行阶段可回退到 `summary` / `workflow_output`。
- `存` 行：选择 `delivery-summary`。

如果现有 `WorkflowArtifact` 的 `stage` / `type` / `relativePath` 无法稳定推导当前产物，则在 `server/domains/workflows/wo-read-model.js` 为 `WorkflowRoleSummaryRow` 增加 `currentArtifactRef`，并同步更新 `src/types/app.ts`。这个字段只保存当前轮次产物，不包含历史轮次列表。

产物链接使用现有 `resolveArtifactPath` 和 `onOpenArtifactFile`，目录产物不作为本次角色行主链接，避免和当前轮次 JSON 产物混淆。

## 风险与处理

- **状态聚合误导用户**：聚合颜色必须按 active/failed 优先，不能简单取最后一个或第一个。
- **隐藏可调试信息**：完整 session id 不显示在页面正文，但保留在 DOM title/aria-label 或调试数据中。
- **错误显示历史产物**：选择产物时必须按轮次取最大编号，不渲染更小编号的 review/repair artifact。
- **卡片和侧边栏不一致**：`WorkflowStageProgress` 同时用于项目概览和侧边栏，聚合逻辑放在该组件内部，两个入口自然一致。

## 测试策略

执行阶段应新增真实业务测试，而不是只检查组件存在：

- `docs/changes/20-优化工作流卡片和详情链接呈现/tests/workflow-card-stage-counts.spec.js`
  - 用 Playwright 打开项目概览，构造多轮 review/repair 工作流，断言卡片和侧边栏只显示聚合后的审核/修复入口及 `xN`。
- `docs/changes/20-优化工作流卡片和详情链接呈现/tests/workflow-detail-role-summary.spec.js`
  - 打开工作流详情，断言 `写` / `审` 行显示 `会话`、数字计数、当前轮次产物链接。
  - 点击 `会话` 后确认仍进入对应 child session。
  - 点击 `review-2.json` 后确认打开当前轮次文件。
- 如新增 `currentArtifactRef`，补充 server read-model 测试，断言多轮产物只输出当前轮次引用。

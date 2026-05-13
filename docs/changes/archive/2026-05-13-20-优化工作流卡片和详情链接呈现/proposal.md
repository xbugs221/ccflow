## 背景

ccflow 前端工作流列表和详情页已经能展示 wo 运行态，但呈现密度在多轮审核/修复后变差：

- 工作流卡片中 `review_1`、`repair_1`、`review_2`、`repair_2` 会各自新增图标，轮次越多越挤。
- 工作流详情页的 `写`、`审` 等角色行用一串 `✓✓✓` 表示次数，信息密度低且容易干扰阅读。
- 角色行里的会话链接直接显示完整 session label/id，文字过长。
- 用户需要快速打开当前轮次产物，例如当前为第二轮审核时只看到 `review-2.json`，而不是被前几轮产物干扰。

当前问题集中在展示层，不要求改变 wo 运行流程或产物生成协议。

## 目标

- 工作流卡片把多轮审核/修复聚合成单个图标加数字，例如审核图标 `x3`、修复图标 `x2`。
- 详情页 `写`、`审` 等角色行后面的重复勾号改为数字计数。
- 角色行前面的会话链接统一显示为 `会话`，点击后仍跳转到原来的 child session。
- 在 `会话` 链接后追加当前轮次产物链接，例如 `review-2.json`。
- 当前轮次产物只显示最新/当前轮，不显示历史轮次产物，例如有 `review-1.json` 和 `review-2.json` 时只显示 `review-2.json`。

## 变更范围

```text
src/components/workflow/WorkflowStageProgress.tsx
  +-- 聚合 review_N / repair_N 或 fix_N 阶段
  +-- 聚合后显示 xN 数字
  +-- 保留 active / failed / completed 的状态颜色

src/components/main-content/view/subcomponents/WorkflowDetailView.tsx
  +-- 角色摘要行的会话链接文案改为“会话”
  +-- 角色摘要行的 checkCount 改为数字 badge
  +-- 在会话链接后展示当前轮次产物链接
  +-- 点击产物链接仍调用现有 onOpenArtifactFile

src/types/app.ts
  +-- 如需要，补充角色摘要行可引用的当前产物字段

server/domains/workflows/wo-read-model.js
  +-- 如前端无法稳定从 artifacts 推导当前产物，则在 read model 层补充 currentArtifactRef

tests/spec/
tests/server/
  +-- 用真实工作流 read model 和页面交互覆盖展示行为
```

## 非目标

- 不改变 wo sealed run、runner 状态机或产物命名规则。
- 不修改工作流启动、继续、归档逻辑。
- 不重做工作流详情页整体布局。
- 不改变会话跳转目标，只改变可见链接文案。
- 不显示全部历史审核/修复产物列表。

## 测试意图

- 浏览器业务测试：构造一个含 `review_1`、`repair_1`、`review_2` 的工作流，项目卡片只显示一个审核图标和一个修复图标，并用 `x2` / `x1` 表示轮次。
- 浏览器业务测试：详情页 `写`、`审` 行不再出现连续多个 `✓`，而显示数字计数。
- 浏览器业务测试：详情页角色行的 session 链接可见文本为 `会话`，点击后仍进入对应会话。
- 浏览器业务测试：当同时存在 `review-1.json` 与 `review-2.json` 时，`审` 行只显示并打开 `review-2.json`。
- 读模型测试：若执行阶段需要新增 `currentArtifactRef`，必须验证它只指向当前轮次产物。

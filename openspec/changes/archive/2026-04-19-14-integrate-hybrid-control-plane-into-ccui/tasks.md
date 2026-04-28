## 1. 控制面领域迁移

- [x] 1.1 梳理 `hybrid-agent-control-plane` 中需要迁入 CCUI 的 session store、orchestrator、inspection 与 gate decision 语义
- [x] 1.2 在 CCUI 服务端建立 workflow session、execution snapshot、artifact trace 的持久化与读模型
- [x] 1.3 为项目工作流列表、工作流详情、子会话 inspection 与 workflow action 提供 API
- [x] 1.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-workflow-control-plane.spec.js -g "控制面工作流详情展示阶段与子会话入口"` 通过

## 2. 项目侧边栏双分组

- [x] 2.1 在项目展开视图中区分“手动会话”和“需求工作流”两个分组
- [x] 2.2 让需求工作流支持折叠、计数和当前选中态
- [x] 2.3 保持手动会话交互不回退
- [x] 2.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-workflow-control-plane.spec.js -g "项目侧边栏按手动会话与需求工作流分组显示"` 通过

## 3. 稳定排序与未读提示

- [x] 3.1 将项目排序改为字母序稳定排序
- [x] 3.2 当项目内出现未查看的新活动时显示绿点，而不是把项目移到顶部
- [x] 3.3 对手动会话与需求工作流两类活动统一计算项目未读状态
- [x] 3.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-workflow-control-plane.spec.js -g "项目列表保持字母序并以绿点提示未读活动"` 通过

## 4. 需求工作流闭环

- [x] 4.1 允许用户在 CCUI 内创建需求工作流并保存 intake 信息
- [x] 4.2 让 workflow 在刷新后仍能保留 planning、execution、verification、acceptance 状态
- [x] 4.3 迁入 artifact 回链、验收门禁与子会话导航语义
- [x] 4.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-workflow-control-plane.spec.js` 全部通过

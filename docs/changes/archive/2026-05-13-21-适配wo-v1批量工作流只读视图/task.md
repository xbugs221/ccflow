## 1. 后端 read model

- [x] 1.1 读取 `batches/<batchId>/state.json`，生成 batch 摘要 read model。
- [x] 1.2 为每个子 run 附加 `batchId`、`batchDisplayId`、`batchIndex`、`batchTotal`、`batchStatus`。
- [x] 1.3 将 run 阶段归并为 `规 / 写 / 审 / 修 / 存` 五阶段摘要。
- [x] 1.4 正确映射 `executor`、`reviewer`、`fixer`、`archiver` 会话角色。
- [x] 1.5 支持 `codex:*`、`opencode:*` 等 provider 前缀；未知 provider 不生成坏链接。
- [x] 1.6 扫描 run 目录固定产物 `review-N.json`、`fix-N.json`、`repair-N.json`。
- [x] 1.7 输出可由前端直接打开的 artifact 路径或受控 artifact 引用。

## 2. 自动工作流总览

- [x] 2.1 将自动工作流区域改为 batch 分组 + 单独运行区域。
- [x] 2.2 batch header 显示 `批量任务 bN`、状态和 `current/total` 进度。
- [x] 2.3 batch header 只负责展开/收起，不进入详情页。
- [x] 2.4 子 run 行显示提案名称、运行状态和五阶段摘要。
- [x] 2.5 点击子 run 后进入现有 `/runs/<runId>` 详情路由。
- [x] 2.6 未归属 batch 的 run 仍可在"单独运行"区域访问。

## 3. run 详情页

- [x] 3.1 顶部显示 batch breadcrumb 和 `bN index/total` 上下文。
- [x] 3.2 按 `规 / 写 / 审 / 修 / 存` 展示阶段状态。
- [x] 3.3 会话链接统一使用短文本，点击进入对应 workflow child session。
- [x] 3.4 `审` 行显示当前最大轮次 `review-N.json`。
- [x] 3.5 `修` 行显示当前最大轮次 `fix-N.json` 或兼容 `repair-N.json`。
- [x] 3.6 点击产物链接后直接打开 JSON 内容。
- [x] 3.7 不为不存在产物或不支持 provider 渲染坏链接。

## 4. 手动会话过滤

- [x] 4.1 后端 provider session 列表过滤 workflow `childSessions`。
- [x] 4.2 后端 provider session 列表过滤 workflow `runnerProcesses.sessionId`。
- [x] 4.3 后端 provider session 列表过滤 wo state `sessions` role map 中的会话。
- [x] 4.4 前端手动会话区域保留 `isWorkflowOwnedSession` 兜底过滤。
- [x] 4.5 确认工作流会话仍可从 run 详情页进入。

## 5. 只读约束

- [x] 5.1 batch UI 不提供 skip、reorder、resume、retry、abort 操作。
- [x] 5.2 前端不直接写 batch state 或 run state。
- [x] 5.3 如未来新增干预能力，必须通过 wo 稳定命令和确认流程；本次不实现。

## 6. 测试和验证

- [x] 6.1 新增 server read-model 测试覆盖 batch state 读取和子 run 关联。
- [x] 6.2 新增 server read-model 测试覆盖 五阶段和 fixer/archiver 映射。
- [x] 6.3 新增 server read-model 测试覆盖 run 目录固定 JSON 产物发现。
- [x] 6.4 新增 Playwright 测试覆盖自动工作流 batch 只读分组（需运行服务器）。
- [x] 6.5 新增 Playwright 测试覆盖 run 详情五阶段、会话链接和产物打开（需运行服务器）。
- [x] 6.6 新增或更新测试覆盖手动会话区域过滤工作流发起的会话卡片（需运行服务器）。
- [x] 6.7 运行 `oz validate 2026-05-13-21-适配wo-v1批量工作流只读视图 --json`。
- [x] 6.8 运行受影响的 server 和前端业务测试（150/150 server tests pass）。

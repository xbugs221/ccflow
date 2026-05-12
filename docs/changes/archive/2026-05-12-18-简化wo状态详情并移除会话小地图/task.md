## 1. read model 适配 wo 0.9 固定角色行

- [x] 1.1 梳理 `wo-read-model.js` 当前 `workflowDisplay.lines` 和 `childSessions` 生成逻辑。
- [x] 1.2 新增或调整 `workflowRoleSummary.rows`，从 `state.stages` 汇总 `规/写/审/存` 固定角色行。
- [x] 1.3 将 `execution` 与 `fix_N`、历史 `repair_N` 计入 `写` 行次数。
- [x] 1.4 将所有 `review_N` 计入 `审` 行次数。
- [x] 1.5 将 `archive` 计入 `存` 行次数，并优先绑定 `sessions.archiver` 或 `sessions.codex:archiver`。
- [x] 1.6 在缺少 planning 会话时保留 `规 未知`，不生成无效 sessionRef。

## 2. 工作流详情页展示简化

- [x] 2.1 修改 `WorkflowDetailView.tsx`，优先渲染固定角色行作为主进度。
- [x] 2.2 保留角色行会话链接，点击后复用现有 workflow child session 路由。
- [x] 2.3 移除主进度中按轮次展开的 `1 fix review`、`2 fix review` 列表形态。
- [x] 2.4 保留旧 `workflowDisplay.lines` 的最小兼容展示，防止旧状态无新结构时空白。

## 3. 移除 workflow child session 小地图

- [x] 3.1 删除 `MainContent.tsx` 中 `workflow-minimap` 浮动组件。
- [x] 3.2 删除小地图拖拽、折叠、位置状态和相关常量。
- [x] 3.3 删除 `WorkflowDetailView treeOnly` 在 child session 右上预览中的使用。
- [x] 3.4 确认普通手动会话和 workflow child session 均不再渲染小地图。

## 4. 真实测试代码

- [x] 4.1 在仓库根 `tests/` 目录编写 read model 测试（项目约定直接写根测试，不在提案目录保留 tests/ 子目录）。
- [x] 4.2 更新 `tests/server/wo-workflow-contract.test.js`，覆盖 0.9 风格 `state.json` 折叠成固定角色行。
- [x] 4.3 更新 `tests/server/go-workflow-runner-integration.test.js`，断言 `archive` 使用 archiver session。
- [x] 4.4 更新工作流详情 Playwright 测试，断言详情页展示 `规/写/审/存` 固定角色行和勾数量。
- [x] 4.5 更新 child session 路由 Playwright 测试，断言点击角色行进入真实会话。
- [x] 4.6 移除或改写“小地图可拖动”测试，改为断言 `workflow-minimap` 和拖拽手柄不存在。

## 5. 验证

- [x] 5.1 运行 `oz validate 18-简化wo状态详情并移除会话小地图 --json`。
- [x] 5.2 运行工作流相关 server 测试。
- [x] 5.3 运行工作流详情和 child session 相关 Playwright 测试（39/39 全部通过）。
- [x] 5.4 手动确认本变更没有启动 `wo`，没有创建 sealed run 运行态文件。

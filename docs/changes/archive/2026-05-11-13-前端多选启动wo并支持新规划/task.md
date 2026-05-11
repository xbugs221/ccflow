## 1. 工作流操作入口

- [x] 1.1 梳理项目主页和工作区侧栏中现有 `新建工作流`、active change 读取、workflow 创建逻辑。
- [x] 1.2 将主入口调整为按钮触发的工作流操作弹窗。
- [x] 1.3 移除或降级主路径中的 `<select>` 单选交互，避免用户用下拉框启动 wo。
- [x] 1.4 让项目主页和工作区侧栏复用同一套 active change 选择与启动行为。

## 2. active change 多选与批量启动

- [x] 2.1 在弹窗中以卡片、按钮或复选项展示可接手 active oz changes。
- [x] 2.2 支持多选、全选、取消选择和已选数量展示。
- [x] 2.3 点击 `启动选中工作流` 后，按 change 逐项调用工作流创建接口。
- [x] 2.4 为每个 change 展示等待、启动中、已启动、失败状态。
- [x] 2.5 单个启动成功时直接跳转 workflow 详情；多个启动成功时展示结果列表和入口。
- [x] 2.6 启动完成后刷新项目、workflow 列表和可接手 change 列表。

## 3. 新规划入口

- [x] 3.1 在工作流操作弹窗中增加 `发起新的规划` 按钮。
- [x] 3.2 复用现有 Codex 会话创建能力，创建普通规划会话。
- [x] 3.3 为规划会话注入初始提示，要求先讨论问题、范围、非目标和测试策略，再创建 oz change。
- [x] 3.4 确认新规划入口不调用 `wo run`，不创建 `.wo/runs/`。
- [x] 3.5 如果现有会话创建能力无法稳定承载规划元数据，再补最小后端 API。

## 4. 工作流详情和会话展示

- [x] 4.1 保留 `workflowDisplay.lines` 作为 workflow 详情主视图。
- [x] 4.2 确认 `start`、`review`、`fix` 等行以可点击按钮展示。
- [x] 4.3 点击可匹配 child session 的行后进入现有 workflow child session 路由。
- [x] 4.4 未匹配 child session 的行保留纯文本展示，不生成无效按钮。

## 5. 真实测试代码

- [x] 5.1 在本提案 `tests/` 目录编写真实 Playwright 测试，执行阶段同步到仓库根测试套件。
- [x] 5.2 更新旧 workflow kickoff 测试，把下拉框选择改为弹窗多选按钮流程。
- [x] 5.3 新增多选两个 active changes 并批量启动两个 workflow 的 Playwright 测试。
- [x] 5.4 新增批量启动部分失败时保留成功结果和失败提示的 Playwright 测试。
- [x] 5.5 新增发起新规划会话的 Playwright 测试，并断言没有创建 `.wo/runs/`。
- [x] 5.6 新增或保留 server 测试，确认 `openspecChangeName` 创建 workflow 仍调用 `wo run --change`。
- [x] 5.7 新增 workflow display line 点击进入 child session 并展示真实消息的回归测试。

## 6. 验证

- [x] 6.1 运行 `oz validate 13-前端多选启动wo并支持新规划 --json`。
- [x] 6.2 运行工作流相关 server 测试。
- [x] 6.3 运行工作流操作相关 Playwright 测试。
- [x] 6.4 手动确认规划入口只创建普通会话，不启动 sealed run。

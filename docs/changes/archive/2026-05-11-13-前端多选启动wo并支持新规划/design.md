## 总体设计

本变更把“启动 wo”从表单式创建改成显式工作流操作面板。前端只负责选择、确认、展示启动结果和导航；后端继续作为 `oz`/`wo` 的唯一执行边界。

```text
Browser
  |
  | GET /api/projects/:projectName/openspec/changes
  v
Workflow Action Dialog
  |
  +-- multi-select active changes
  |      |
  |      | POST /api/projects/:projectName/workflows
  |      | { openspecChangeName }
  |      v
  |    wo run --change <name> --json
  |
  `-- start planning
         |
         v
       Codex planning session
```

## 关键决策

### 使用按钮和弹出框，不使用下拉框作为主路径

active changes 是用户要执行的业务对象，不是表单字段。弹出框能同时承载多选、批量状态、错误提示和新规划入口；下拉框只能表达单选，不适合批量启动。

### 多选启动采用逐项请求

前端对每个 selected change 调用一次现有创建工作流接口。这样后端不用引入批量事务语义，也能让前端展示每个 change 的独立成功或失败状态。

```text
selected changes:
  13-a  -> POST /workflows -> run-a
  13-b  -> POST /workflows -> run-b
  13-c  -> POST /workflows -> failed
```

如果执行阶段发现逐项请求导致 UI 状态过散，再考虑后端新增 batch endpoint；本提案默认不新增。

### 发起新规划不等于启动 sealed run

「发起新的规划」必须进入普通聊天规划流程。该会话的目标是产出新的 oz change，而不是创建 `.wo/runs/` 或调用 `wo run`。

规划提示应包含：

- 先讨论问题、范围、非目标和测试策略；
- 用户确认后再创建 oz change；
- 不启动 sealed run。

### 会话内容复用现有子会话路由

工作流详情页已经能把 `workflowDisplay.lines` 匹配到 child session。执行阶段应继续复用现有路由：

```text
/workspace/<project>/runs/<runId>/sessions/<stage>
```

这样能复用已有聊天消息渲染、JSONL 读取、文件链接和工具调用展示，不在工作流详情页重复实现聊天视图。

## 风险与处理

- **部分成功**：批量启动中某些 change 成功、某些失败。弹窗必须保留结果列表，成功项提供 workflow 入口，失败项显示错误并允许重试。
- **重复启动**：启动前 active changes 来自后端 adoptable 列表；启动后必须刷新，避免已绑定 change 继续出现在可选列表。
- **新规划误触发执行**：规划按钮不得调用 workflow create API，也不得写 `.wo/runs/`。
- **旧测试依赖下拉框**：执行阶段需要更新旧的 workflow kickoff 测试，从 selectOption 改为弹窗多选按钮。

## 测试策略

执行阶段应新增或更新真实测试代码：

- Playwright 覆盖项目主页弹出工作流操作框，断言没有下拉框主路径。
- Playwright 准备两个 active oz changes，多选后批量启动，断言出现两个 workflow 入口。
- Playwright 覆盖部分失败：一个 fake `wo run` 成功、一个失败，断言成功项可进入详情，失败项留在结果中。
- Playwright 覆盖「发起新的规划」：点击后进入普通 Codex 会话，显示规划提示，且项目目录没有新增 `.wo/runs/`。
- Server 测试覆盖单个 `openspecChangeName` 创建仍调用 `wo run --change`，保证前端多选只是编排多次现有能力。
- Regression 覆盖 workflow child session 仍能从 `workflowDisplay.lines` 按钮进入并展示消息。

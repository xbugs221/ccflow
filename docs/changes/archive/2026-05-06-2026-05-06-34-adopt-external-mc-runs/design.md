# Design: 外部 mc run 发现与接管

## 源码事实

- `GET /api/projects/:projectName/workflows` 返回 `attachWorkflowMetadata(await getProjects())` 后的 `project.workflows`。
- `attachWorkflowMetadata()` 调用 `listProjectWorkflows(projectPath)`。
- `listProjectWorkflows()` 只从 `readWorkflowStore(projectPath)` 得到 workflow 列表。
- `readWorkflowStore()` 只展开 `.ccflow/conf.json` 的 `workflows` 字段；没有扫描 `.ccflow/runs/*/state.json`。
- `applyGoRunnerReadModel()` 只有在 workflow 已经有 `runner: "go"` 且有 `runId` 时，才读取 `.ccflow/runs/<run-id>/state.json`。
- `setupGoRunnerWatchers()` 只为已登记的 Go-backed workflow 调用 `watchGoWorkflowRun()`；外部 run 目录不会被监听。

## 当前问题

```text
Web 创建 workflow
  |
  |-- createProjectWorkflow()
  |-- startGoWorkflowRun()
  |-- 写 .ccflow/conf.json.workflows["N"].runId
  `-- 前端列表可见

外部终端 mc run
  |
  |-- 写 .ccflow/runs/<run-id>/state.json
  |-- 不写 .ccflow/conf.json.workflows
  `-- 前端列表不可见
```

当前系统把两个事实源分成了不同职责：

```text
.ccflow/conf.json.workflows
  `-- Web 控制面索引和 route id

.ccflow/runs/<run-id>/state.json
  `-- Go runner sealed state
```

问题不是 React 列表渲染错误，而是外部 run 没有进入 Web 控制面索引。

## 目标数据流

```text
listProjectWorkflows(projectPath)
  |
  |-- 读取 .ccflow/conf.json.workflows
  |-- 扫描 .ccflow/runs/*/state.json
  |-- 归一化 runId/changeName 字段
  |-- 找出未被 workflows[].runId 绑定的 external run
  |-- 为 external run 生成/持久化 workflow record
  |-- applyGoRunnerReadModel()
  `-- 返回完整 ProjectWorkflow[]
```

## 决策

### 1. 默认自动接管，而不是只读临时展示

外部 run 需要稳定 URL，例如 `/projects/<project>/wN`。如果每次请求临时从 runs 目录生成 workflow，route id 可能随排序、归档、删除发生漂移。因此 discovery 发现未登记 run 后，应补写 `.ccflow/conf.json.workflows`，持久化最小 workflow record。

最小记录建议为：

```json
{
  "runner": "go",
  "runnerProvider": "codex",
  "runId": "<normalized-run-id>",
  "openspecChangeName": "<normalized-change-name>",
  "title": "<change-name or run-id>",
  "stage": "<runner-stage>",
  "runState": "<running|completed|blocked>"
}
```

### 2. runId 归一化优先级

```text
runId = state.runId || state.run_id || basename(runDir)
changeName = state.changeName || state.change_name || ""
```

理由：

- 当前 `mc` 实际写出的 `state.json` 使用 `run_id/change_name`。
- 既有 Web contract 和测试使用 `runId/changeName`。
- 当 state 字段缺失时，run 目录名仍是唯一定位 `state.json` 的稳定 key。

### 3. 状态归一化

```text
runner status        Web runState
---------------------------------
running/active       running
done/completed       completed
archived             completed
failed/error/aborted blocked
其他/缺失            running 或 blocked，取决于 state 是否可解析
```

`stage` 保留 runner state 的原始阶段；如果 runner stage 是 `done`，Web 可继续显示 `archive` 或 `done`，但 read model 必须明确 `runState: completed`。

### 4. 去重规则

已登记 workflow 的 run id 集合必须同时比较：

```text
workflow.runId
state.runId
state.run_id
basename(runDir)
```

同一个 run 不得生成多个 workflow。若多个 workflow 绑定同一 run，应保留 routeIndex 最小的记录，并在 read model 中暴露诊断事件或日志。

### 5. watcher 初始化

`setupGoRunnerWatchers()` 需要先触发 discovery，再为所有 Go-backed workflow 注册 watcher：

```text
setupGoRunnerWatchers()
  -> attachWorkflowMetadata(getProjects())
     -> listProjectWorkflows()
        -> discoverExternalGoRuns()
        -> persist adopted workflows
  -> watchGoWorkflowRun(project, workflow)
```

这样外部终端继续推进时，WebSocket 项目刷新事件才会到达前端。

## 风险

- 自动接管会写 `.ccflow/conf.json`，可能让用户感知到“只刷新页面也修改配置”。但这是获得稳定 workflow route 的必要代价。
- 历史 `.ccflow/runs` 可能很多；扫描应限制为 `runs/*/state.json`，避免递归读取日志。
- 损坏的 `state.json` 不应让整个项目工作流列表失败；应跳过该 run 并记录可诊断错误。
- 已归档或删除的 run 是否继续显示需要产品决策。本变更默认显示未登记的 completed/running run，因为用户明确提到“已完成或在进行的工作流”都应被检测到。

## 验收策略

### 后端单测

- 项目没有 `.ccflow/conf.json.workflows`，但存在 `.ccflow/runs/run-a/state.json`，`listProjectWorkflows()` 返回一个 Go-backed workflow。
- state 只有 `run_id/change_name` 时，read model 的 `runId/openspecChangeName` 正确。
- 第二次调用 `listProjectWorkflows()` 不重复创建 workflow，route id 保持稳定。
- 已有 workflow 绑定同一 run 时，discovery 不创建重复记录。
- 损坏的 `state.json` 不影响其他正常 run 的展示。

### 集成/前端验收

```text
1. 在项目目录外部终端运行 mc，使其写入 .ccflow/runs/<run-id>/state.json
2. 不通过 Web UI 创建 workflow
3. 刷新项目工作流列表
4. 列表出现该 run 对应 workflow
5. 点击进入详情页能看到 run id、change、stage、status、日志入口
6. runner 后续更新 state.json 后，前端能刷新状态
```

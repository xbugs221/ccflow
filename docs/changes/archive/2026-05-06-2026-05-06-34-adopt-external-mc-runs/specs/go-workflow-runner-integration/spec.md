## 新增需求

### 需求：ccflow 必须发现外部终端启动的 Go runner run

系统必须发现项目 `.ccflow/runs/*/state.json` 中尚未被 Web workflow 控制面登记的 Go runner run，并将其纳入项目 workflow read model。

#### 场景：发现未登记的运行中 run
- **当** 项目 `.ccflow/conf.json` 不包含任何 `workflows`
- **且** `.ccflow/runs/<run-id>/state.json` 存在
- **且** runner state 表示 run 正在运行
- **则** 后端列出项目 workflows 时 MUST 返回该 run 对应的 Go-backed workflow
- **且** workflow MUST 包含稳定的 `runId`、`openspecChangeName`、`stage` 和 `runState`

#### 场景：发现未登记的已完成 run
- **当** `.ccflow/runs/<run-id>/state.json` 表示 run 已完成
- **且** 该 run 尚未被 `.ccflow/conf.json.workflows` 绑定
- **则** 后端列出项目 workflows 时 MUST 返回该 run 对应的 completed workflow
- **且** 该 workflow MUST 保留 runner artifact 和日志入口

#### 场景：兼容 runner snake_case state 字段
- **当** runner state 只包含 `run_id` 和 `change_name`
- **则** 后端 MUST 将 `run_id` 映射为 Web read model 的 `runId`
- **且** 后端 MUST 将 `change_name` 映射为 Web read model 的 `openspecChangeName`
- **且** 缺少 `runId` 时 MUST 使用 run 目录名作为稳定 fallback

#### 场景：不重复接管已登记 run
- **当** `.ccflow/conf.json.workflows` 已有 workflow 绑定某 run
- **且** `.ccflow/runs/<run-id>/state.json` 也存在
- **则** discovery MUST 复用既有 workflow
- **且** 不得为同一 run 创建第二个 workflow route

#### 场景：隔离损坏的 runner state
- **当** 某个 `.ccflow/runs/<run-id>/state.json` 不是合法 JSON
- **则** 后端 MUST 跳过该 run 或记录诊断错误
- **且** 其他合法 run 仍 MUST 正常出现在 workflow 列表中

### 需求：外部 Go runner run 接管后必须可持续刷新

系统必须在接管外部 Go runner run 后监听该 run 目录，使 state、日志和 artifact 变化能刷新前端 workflow read model。

#### 场景：服务启动时注册外部 run watcher
- **当** ccflow 服务启动
- **且** 项目存在未登记的 Go runner run
- **则** 后端 MUST 先执行 run discovery
- **然后** 为接管后的 Go-backed workflow 注册 `.ccflow/runs/<run-id>` watcher

#### 场景：外部 run 更新后刷新项目
- **当** 已接管外部 run 的 `state.json` 发生变化
- **则** 后端 MUST 触发项目更新事件
- **且** 前端重新读取 workflow 后 MUST 展示最新 stage 和 runState

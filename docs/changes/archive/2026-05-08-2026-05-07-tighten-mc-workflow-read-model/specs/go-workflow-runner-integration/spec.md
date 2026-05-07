## 新增需求

### 需求：Go runner state 必须有明确的 Web read model contract

系统必须把 `.ccflow/runs/<run-id>/state.json` 作为 workflow read model 的唯一 runner fact 输入，并通过后端 adapter 归一化为前端 `ProjectWorkflow`。

#### 场景：最小 state 可显示 workflow
- **当** 项目存在 `.ccflow/runs/run-a/state.json`
- **且** state 至少包含 `status` 和 `stage`
- **则** workflow list 必须显示 run `run-a`
- **且** `ProjectWorkflow.id` 和 `ProjectWorkflow.runId` 必须使用 state 的 `runId/run_id` 或目录名 fallback
- **且** 该 workflow 不依赖 `.ccflow/conf.json.workflows`

#### 场景：字段同时支持 camelCase 和 snake_case
- **当** runner state 使用 `run_id`、`change_name`、`session_id` 或 `log_path`
- **则** 后端必须映射为 Web read model 的 `runId`、`openspecChangeName`、`sessionId` 和 `logPath`
- **且** 同一个字段的 camelCase 和 snake_case 不得生成重复 workflow、process 或 child session

#### 场景：updatedAt 来源稳定
- **当** runner state 包含 `updatedAt` 或 `updated_at`
- **则** workflow read model 的 `updatedAt` 使用该值
- **当** runner state 不包含更新时间
- **则** workflow read model 使用 `state.json` 文件 mtime
- **且** 刷新页面不得因为 adoption time 变化导致 workflow 默认排序抖动

### 需求：Runner paths 必须按语义映射为日志和 artifacts

系统必须把 runner `paths` 映射成用户可理解的日志入口和 artifact 入口，而不是把所有路径渲染成同一种文件。

#### 场景：日志路径进入 process 行
- **当** runner state 的 `paths` 包含 `executor_log`、`reviewer_log`、`<stage>_log` 或 `<stage>_<role>_log`
- **则** 对应 runner process 包含 project-relative slash `logPath`
- **且** workflow detail 在 process 行显示日志入口

#### 场景：交付产物按语义展示
- **当** runner state 的 `paths` 包含 `summary`、`delivery_summary`、`repair_1_summary`、`review_1` 或 `workflow_output`
- **则** workflow read model 的 artifacts 包含语义化 type、stage、label 和 relative path
- **且** UI 能区分日志、review result、repair summary、delivery summary 和 output directory

#### 场景：内部状态文件不展示为 artifact
- **当** runner state 的 `paths` 包含 `state`、`state_json`、lock file 或空路径
- **则** 后端不得把这些路径加入用户 artifact 列表

### 需求：Runner processes 和 sessions 必须生成稳定 child session 地址

系统必须为 runner-owned sessions 生成稳定的 workflow child route，使用户能从网页进入对应 Codex thread。

#### 场景：单阶段单会话使用 stage route
- **当** runner state 包含 execution session
- **则** child session 地址为 `/runs/<runId>/sessions/execution`
- **且** 地址不需要 `provider`、`projectPath` 或 `workflowId` 查询参数

#### 场景：同阶段多角色使用 stage role route
- **当** 同一 stage 下存在多个 role 的 sessions
- **则** child session 地址必须能包含 role，例如 `/runs/<runId>/sessions/<stage>/<role>`
- **且** 点击 process row 必须进入对应 role 的 session

#### 场景：重复 stage role 使用 session id fallback
- **当** 同一 stage 和 role 下存在多个 session id
- **则** 后端必须提供 by-id 地址，例如 `/runs/<runId>/sessions/by-id/<sessionId>`
- **且** UI 不得把多个 session 链接到同一个错误地址

### 需求：损坏或缺失 state 必须可诊断且不影响其他 run

系统必须隔离单个 runner state 文件的读取失败。

#### 场景：单个 state JSON 损坏
- **当** 项目中一个 run 的 `state.json` 不是合法 JSON
- **且** 同项目存在其他合法 run
- **则** 合法 run 仍必须显示
- **且** 损坏 run 必须在 diagnostics 中暴露错误或被带警告地跳过

#### 场景：state 引用的文件缺失
- **当** runner state 的 paths 指向不存在的日志或 artifact
- **则** read model 必须保留该引用并标记 `exists: false` 或 warning
- **且** UI 必须展示可诊断状态，而不是静默丢失整条 workflow


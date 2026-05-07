## 新增需求

### 需求：ccflow 自动工作流必须仅使用 Go mc runner

系统必须把自动工作流执行职责完全委托给 Go `mc` runner。Node/TS 代码只能作为 Web 控制面和 runner adapter，不得再自行推进 execution、review、repair 或 archive 阶段。

#### 场景：创建工作流只启动 mc run
- **当** 用户在 Web UI 中创建自动工作流
- **则** 后端调用 `mc run --change <change-name> --json`
- **且** 后端不得把返回的 `runId` 写入 `.ccflow/conf.json.workflows`
- **且** 后端通过 `.ccflow/runs/<run-id>/state.json` 让该 workflow 出现在前端列表
- **且** 后端不得创建旧 Node/TS 自动阶段子会话
- **且** 后端不得启动 `server/workflow-auto-runner.js` 推进该 workflow

#### 场景：恢复工作流只调用 mc resume
- **当** 用户恢复一个未完成 workflow
- **且** 请求路由或请求体包含 `runId`
- **则** 后端调用 `mc resume --run-id <run-id> --json`
- **且** 后端重新从 `.ccflow/runs/<run-id>/state.json` 读取阶段状态
- **且** 后端不得根据旧 Node 内存 action key 判断下一阶段

#### 场景：中止工作流只调用 mc abort
- **当** 用户中止一个 Go-backed workflow
- **则** 后端调用 `mc abort --run-id <run-id> --json`
- **且** 工作流 read model 展示 runner state 中的中止状态和错误信息
- **且** 后端不得用旧 TS runner 改写该 run 的阶段状态

#### 场景：mc 缺失时不回退到 TS runner
- **当** 服务进程 PATH 中不存在可执行的 `mc`
- **或** `mc contract --json` 不满足 runner contract
- **则** 创建、恢复和中止 workflow 的接口返回明确错误
- **且** runtime diagnostics 展示 `mc` 缺失或 contract 不匹配原因
- **且** 系统不得启动旧 Node/TS workflow runner 作为 fallback

#### 场景：状态刷新只信任 mc state
- **当** 前端刷新 workflow 列表或详情页
- **且** 项目存在 `.ccflow/runs/<run-id>/state.json`
- **则** 后端从 `.ccflow/runs/<run-id>/state.json` 派生 `stage`、`runState`、`stageStatuses`、`runnerProcesses`、`artifacts` 和 `childSessions`
- **且** `.ccflow/conf.json.workflows` 不得参与 workflow read model

### 需求：旧 Node/TS 工作流执行器必须从运行路径移除

系统必须移除旧 Node/TS workflow 自动推进器的运行入口，使其无法被服务启动、项目刷新、WebSocket 事件或 workflow route 间接触发。

#### 场景：服务启动不注册旧 runner
- **当** ccflow 服务启动
- **则** 服务不得导入、启动或调度 `server/workflow-auto-runner.js`
- **且** 服务只为 Go-backed workflow 注册 `.ccflow/runs/<run-id>` watcher

#### 场景：项目刷新不触发旧 runner
- **当** 项目列表刷新或文件 watcher 触发项目更新
- **则** 后端可以重新扫描 `.ccflow/runs/*/state.json`
- **但** 后端不得调用旧 Node/TS 自动推进逻辑创建或恢复阶段会话

#### 场景：旧 runner 专属测试和文档被移除
- **当** 本变更完成
- **则** 仓库中不得保留只验证旧 Node/TS workflow 自动推进器行为的测试
- **且** 仓库中不得保留指导用户使用旧 Node/TS 自动 workflow runner 的文档

### 需求：workflow JSON 必须避免保存 ccflow 镜像索引

系统必须把 `.ccflow/runs/<run-id>/state.json` 作为 workflow 列表和详情的唯一事实来源，防止前端读到 ccflow 自己维护的陈旧镜像索引。

#### 场景：conf 不保存 workflow 索引
- **当** 后端创建、发现或刷新 mc workflow
- **则** 后端不得写入 `.ccflow/conf.json.workflows`
- **且** 后端不得依赖 `.ccflow/conf.json.workflows` 决定 workflow 是否存在

#### 场景：state 保存 runner 事实
- **当** `mc` 更新 `.ccflow/runs/<run-id>/state.json`
- **则** 该文件是 workflow identity、`stage`、`status`、`stages`、`paths`、`sessions` 和 `error` 的事实来源
- **且** 后端不得用 `.ccflow/conf.json` 中的旧 workflow 字段覆盖这些事实

#### 场景：前端 read model 运行时合并
- **当** 前端请求 workflow 列表或详情
- **则** 后端扫描 `.ccflow/runs/*/state.json` 并生成 `ProjectWorkflow`
- **且** 返回值包含前端展示需要的 title、runId、openspecChangeName、stage、runState、stageStatuses、runnerProcesses、artifacts、childSessions 和 diagnostics
- **且** 这些字段不得回写到 `.ccflow/conf.json.workflows`

#### 场景：不保留 ccflow workflow UI 偏好
- **当** 本变更完成
- **则** 后端不得为 workflow 收藏、隐藏、置顶或重命名新增 ccflow 自有持久化表
- **且** 前端不得依赖这些偏好判断 workflow 是否显示

### 需求：Go runner 必须提供 Web 适配 JSON contract

Go runner 必须提供稳定的非交互 JSON 命令，供 Node 后端启动、恢复、查询、中止和列出可执行 change。

#### 场景：启动时校验 runner contract
- **当** 服务启动
- **且** PATH 中存在可执行的 `mc`
- **则** 后端调用 `mc contract --json`
- **则** 输出包含 `json: true`、`version` 和 `capabilities`
- **则** `capabilities` 至少包含 `list-changes`、`run`、`resume`、`status`、`abort`
- **则** 缺少任一能力时服务启动失败并返回明确错误

#### 场景：runner 未安装
- **当** 服务启动
- **且** PATH 中不存在可执行的 `mc`
- **则** 服务启动失败并返回明确错误
- **则** 错误信息说明需要手动安装 `mc` 并确保服务进程 PATH 可见
- **则** 系统不得启动旧 TS auto-runner 作为隐式 fallback

#### 场景：runner 已安装
- **当** 服务启动
- **且** PATH 中存在可执行的 `mc`
- **则** 后端记录实际解析到的 `mc` 路径
- **则** 诊断接口返回该文件路径和版本或 contract 检查结果
- **则** 设置页不提供 runner 路径覆盖入口

#### 场景：查询 run 状态
- **当** 后端调用 `status --run-id <run-id> --json`
- **则** 输出包含 `runId`、`changeName`、`status`、`stage`、`stages`、`paths` 和 `sessions`
- **则** `paths` 中的文件路径为仓库相对 slash path

#### 场景：中止 run
- **当** 用户在 Web UI 中中止一个 running run
- **则** 后端调用 Go runner 的 abort 命令
- **则** runner 更新 `state.json.status`
- **则** 工作流详情页展示已中止状态和中止原因

### 需求：Go runner 状态必须可映射为 Web 进程列表

系统必须将 Go runner 的阶段运行状态映射成稳定的 Web workflow `runnerProcesses` read model，使前端无需解析 runner 终端输出即可展示阶段进程列表。

#### 场景：从 runner sessions 降级生成进程列表
- **当** `.ccflow/runs/<run-id>/state.json` 包含 `sessions.executor`
- **且** `stages.execution` 表示 execution 已启动或完成
- **则** workflow read model 包含 execution 进程行
- **则** 该进程行包含 `stage: "execution"`、`role: "executor"`、`sessionId` 和状态

#### 场景：展示 runner 日志入口
- **当** runner state 的 `paths` 包含某阶段角色的日志路径
- **则** 对应进程行包含仓库相对 slash `logPath`
- **则** 前端可以把该路径作为日志文件链接展示

#### 场景：可选展示 pid 和退出码
- **当** runner JSON contract 提供阶段进程的 `pid`、`exitCode` 或 `failed`
- **则** workflow read model 保留这些字段
- **则** 前端展示已有字段
- **则** 缺失字段不会生成空白假值或错误提示

### 需求：Go runner 子会话必须进入 workflow read model

系统必须将 Go runner 产生或恢复的 Codex session/thread 标记为 workflow-owned child session，而不是普通手动会话。

#### 场景：execution thread 成为 workflow 子会话
- **当** Go-backed workflow 的 runner state 包含 execution 的 executor session id
- **则** workflow read model 的 `childSessions` 包含该 session
- **则** 该 child session 包含 `workflowId`、`stageKey: "execution"`、`provider: "codex"` 和稳定 `routeIndex`

#### 场景：review thread 成为 workflow 子会话
- **当** Go-backed workflow 进入 `review_1`
- **且** runner state 包含 reviewer session id
- **则** workflow read model 的 `childSessions` 包含该 reviewer session
- **则** 该 child session 的 `stageKey` 为 `review_1`

#### 场景：刷新后 routeIndex 稳定
- **当** workflow read model 已经为 runner-owned child session 分配 `routeIndex`
- **且** 用户刷新项目列表或重新打开工作流详情页
- **则** 同一个 child session 继续使用原 routeIndex
- **则** 其 workflow child URL 不变化

### 需求：Go-backed workflow 首期自动阶段只支持 Codex

系统必须明确区分 Go runner 自动阶段支持范围。首期 Go-backed workflow 的自动推进只能使用 Codex，不得继续用旧 TS 状态机补齐其他 provider。

#### 场景：创建 Go-backed workflow
- **当** 用户创建新 workflow
- **则** 系统把 runner provider 设置为 `codex`
- **则** UI 不展示可用于自动阶段的 Claude/OpenCode provider 切换控件

#### 场景：Go-backed workflow 提交非 Codex provider
- **当** 创建 workflow 的请求包含非 Codex 自动阶段 provider
- **则** 系统拒绝该请求或忽略该 provider 配置
- **则** 系统不会启动旧 Node auto-runner 补齐非 Codex 自动阶段

### 需求：ccflow 必须发现外部终端启动的 Go runner run

系统必须发现项目 `.ccflow/runs/*/state.json` 中尚未被 Web workflow 控制面登记的 Go runner run，并将其纳入项目 workflow read model。

#### 场景：发现运行中 run
- **当** 项目 `.ccflow/conf.json` 不包含 workflow 镜像索引
- **且** `.ccflow/runs/<run-id>/state.json` 存在
- **且** runner state 表示 run 正在运行
- **则** 后端列出项目 workflows 时 MUST 返回该 run 对应的 Go-backed workflow
- **且** workflow MUST 包含稳定的 `runId`、`openspecChangeName`、`stage` 和 `runState`

#### 场景：发现已完成 run
- **当** `.ccflow/runs/<run-id>/state.json` 表示 run 已完成
- **且** 项目 `.ccflow/conf.json` 不保存 workflow 绑定
- **则** 后端列出项目 workflows 时 MUST 返回该 run 对应的 completed workflow
- **且** 该 workflow MUST 保留 runner artifact 和日志入口

#### 场景：兼容 runner snake_case state 字段
- **当** runner state 只包含 `run_id` 和 `change_name`
- **则** 后端 MUST 将 `run_id` 映射为 Web read model 的 `runId`
- **且** 后端 MUST 将 `change_name` 映射为 Web read model 的 `openspecChangeName`
- **且** 缺少 `runId` 时 MUST 使用 run 目录名作为稳定 fallback

#### 场景：重复 discovery 保持幂等
- **当** `.ccflow/runs/<run-id>/state.json` 已经被扫描过
- **且** 后续项目刷新再次发现同一 run
- **则** discovery MUST 复用同一个 runId read model
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

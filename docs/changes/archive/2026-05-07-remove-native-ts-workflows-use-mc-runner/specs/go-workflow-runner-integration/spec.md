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

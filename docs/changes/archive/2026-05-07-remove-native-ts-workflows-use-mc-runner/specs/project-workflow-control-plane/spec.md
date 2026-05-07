## 新增需求

### 需求：工作流控制面必须只展示 mc-backed 自动工作流

系统必须把 Web 工作流控制面定义为 Go `mc` runner 的展示和操作层。自动阶段的事实来源必须是 `mc` run state，而不是 ccflow 原生 Node/TS 状态机。

#### 场景：Go-backed workflow 正常展示
- **当** 项目存在 `.ccflow/runs/<run-id>/state.json`
- **则** 工作流列表显示该 workflow
- **且** 工作流详情显示 `mc` run id、stage、runState、artifact、runnerProcesses 和 child session 入口

#### 场景：外部 mc run 仍可被接管
- **当** 项目存在 `.ccflow/runs/<run-id>/state.json`
- **则** 后端列出项目 workflows 时必须直接显示该 run
- **且** 前端必须在对应项目页显示该 workflow
- **且** 该显示不得依赖 `.ccflow/conf.json.workflows` 或旧 Node/TS workflow runner

#### 场景：旧 Node workflow 不再显示
- **当** `.ccflow/conf.json.workflows` 中存在没有 `runId` 的历史 workflow
- **则** 后端不得把该记录纳入前端 workflow read model
- **且** 后端不得为它启动 execution、review、repair 或 archive 阶段
- **且** 后端可以删除整个 `.ccflow/conf.json.workflows` 分组

#### 场景：前端不提供旧 runner provider 配置
- **当** 用户创建或查看自动 workflow
- **则** UI 不提供能切换到 ccflow 原生 Node/TS 自动推进的 provider 控件
- **且** 提交请求中的旧 `stageProviders` 不得改变自动执行器
- **且** workflow 详情页展示的 provider 信息来自 `mc` sealed state 或 Go runner read model

#### 场景：workflow 路由使用 runId
- **当** 用户打开某个 mc workflow
- **则** 前端路由使用该 workflow 的 `runId` 定位
- **且** 后端不得要求存在数字 `wN` routeIndex 才能打开 workflow

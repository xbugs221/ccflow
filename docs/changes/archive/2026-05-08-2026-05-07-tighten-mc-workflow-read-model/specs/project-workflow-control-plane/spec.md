## 新增需求

### 需求：ccflow 工作流控制面只能保存展示派生状态，不能保存 runner 镜像事实

系统必须把 Web 工作流控制面限定为 `mc` runner 的展示和操作层，不得在 `.ccflow/conf.json` 中保存或读取 runner facts 的镜像副本。

#### 场景：conf workflows 不参与 workflow read model
- **当** `.ccflow/conf.json.workflows` 存在任意历史记录
- **且** 项目 `.ccflow/runs` 中没有对应 `state.json`
- **则** workflow list 不显示该历史记录
- **且** workflow detail 无法通过该历史记录打开

#### 场景：创建 workflow 不写 conf workflows
- **当** 用户从 Web UI 创建工作流
- **则** 后端调用 `mc run --change <change> --json`
- **且** 后端等待或发现 `.ccflow/runs/<runId>/state.json`
- **且** 后端不得写入 `.ccflow/conf.json.workflows`

#### 场景：controller event 不写 workflow store
- **当** 后端发现 runner state 有 warning、error、missing file 或 duplicate session address
- **则** 这些信息只能作为 read model diagnostics 返回
- **且** 后端不得为了保存这些事件重建 `.ccflow/conf.json.workflows`

### 需求：旧 Node/TS 自动启动链路必须移除

系统不得保留能间接启动旧 Node/TS 自动阶段会话的前端或后端路径。

#### 场景：工作流继续只走 mc resume
- **当** 用户在 workflow detail 请求继续或恢复
- **则** 后端调用 `mc resume --run-id <runId> --json`
- **且** 前端不得创建 `workflow-autostart` sessionStorage 项
- **且** 后端不得创建 workflow-owned draft session 作为自动阶段入口

#### 场景：自动阶段 prompt 由 mc 拥有
- **当** workflow 进入 planning、execution、review、repair 或 archive
- **则** ccflow 不拼装自动阶段 prompt
- **且** ccflow 不根据 review result 决定 repair/archive 的下一阶段
- **且** 阶段推进结果必须来自 runner state

#### 场景：手动会话仍可创建
- **当** 用户创建普通手动会话
- **则** ccflow 仍可分配 `cN` route 和保存会话标题
- **但** 该流程不得带 `workflowAutoStart`、`autoPrompt` 或自动阶段 metadata

### 需求：工作流详情必须展示 runner diagnostics

系统必须让用户在网页上理解 `mc` run 当前状态和映射问题。

#### 场景：详情页显示基础 diagnostics
- **当** 用户打开 workflow detail
- **则** 页面展示或可展开查看 `runId`、state path、state mtime、raw stage、raw status、runner error
- **且** diagnostics 来源于后端 read model

#### 场景：详情页显示 contract diagnostics
- **当** runtime dependency diagnostics 可用
- **则** workflow detail 或设置页显示 `mc` contract 是否可用、版本和缺失 capability
- **且** 不提供 runner path 覆盖入口

#### 场景：未知字段不破坏展示
- **当** runner state 包含未知 stage、unknown process field 或额外 paths
- **则** read model 保留可诊断 warning
- **且** 已知 stage、process、artifact 仍正常展示


## Purpose

定义 CCUI 中项目级需求工作流控制面的稳定行为，包括侧边栏双分组、workflow 详情页、控制面状态持久化、项目字母序稳定排序，以及未读活动提示。

## Requirements

### Requirement: 工作流控制面必须只展示 mc-backed 自动工作流

系统必须把 Web 工作流控制面定义为 Go `mc` runner 的展示和操作层。自动阶段的事实来源必须是 `mc` run state，而不是 ccflow 原生 Node/TS 状态机。

#### Scenario: Go-backed workflow 正常展示
- **WHEN** 项目存在 `.ccflow/runs/<run-id>/state.json`
- **THEN** 工作流列表显示该 workflow
- **AND** 工作流详情显示 `mc` run id、stage、runState、artifact、runnerProcesses 和 child session 入口

#### Scenario: 外部 mc run 仍可被接管
- **WHEN** 项目存在 `.ccflow/runs/<run-id>/state.json`
- **THEN** 后端列出项目 workflows 时必须直接显示该 run
- **AND** 前端必须在对应项目页显示该 workflow
- **AND** 该显示不得依赖 `.ccflow/conf.json.workflows` 或旧 Node/TS workflow runner

#### Scenario: 旧 Node workflow 不再显示
- **WHEN** `.ccflow/conf.json.workflows` 中存在没有 `runId` 的历史 workflow
- **THEN** 后端不得把该记录纳入前端 workflow read model
- **AND** 后端不得为它启动 execution、review、repair 或 archive 阶段
- **AND** 后端可以删除整个 `.ccflow/conf.json.workflows` 分组

#### Scenario: 前端不提供旧 runner provider 配置
- **WHEN** 用户创建或查看自动 workflow
- **THEN** UI 不提供能切换到 ccflow 原生 Node/TS 自动推进的 provider 控件
- **AND** 提交请求中的旧 `stageProviders` 不得改变自动执行器
- **AND** workflow 详情页展示的 provider 信息来自 `mc` sealed state 或 Go runner read model

#### Scenario: workflow 路由使用 runId
- **WHEN** 用户打开某个 mc workflow
- **THEN** 前端路由使用该 workflow 的 `runId` 定位
- **AND** 后端不得要求存在数字 `wN` routeIndex 才能打开 workflow

### Requirement: 项目侧边栏必须把手动会话与需求工作流作为两类对象展示

系统 MUST 在用户已经进入某个项目的需求工作流详情页或手动会话页时，展示只属于当前项目的工作区导航。该导航中需求工作流 MUST 位于上方分组，手动会话 MUST 位于下方分组；项目外的其他项目列表不得再与该导航混排。

#### Scenario: 项目工作区导航按需求工作流与手动会话分组显示
- **WHEN** 用户已经进入某个项目的 workflow 详情页或手动会话页
- **THEN** 左侧工作区导航显示“需求工作流”分组与“手动会话”分组
- **AND** 当前项目的需求工作流只出现在“需求工作流”分组中
- **AND** 当前项目的手动会话只出现在“手动会话”分组中
- **AND** 其他项目的数据不会出现在该导航中

### Requirement: 需求工作流详情必须展示控制面阶段与子会话入口

系统 MUST 把需求工作流详情页作为控制面展示：包含工作流标题、目标、Go runner 阶段状态、runner artifact 链接、内部会话入口，以及 runner 失败或中止状态。

#### Scenario: 控制面工作流详情展示阶段与子会话入口

- **WHEN** 用户查看某工作流详情页
- **THEN** 系统展示阶段树
- **AND** 每个阶段展示来自 `.ccflow/runs/<run-id>/state.json` 的状态、关键产物、是否已关联内部会话
- **AND** 已有关联内部会话的阶段提供进入该会话的入口
- **AND** 尚未开始的阶段展示下一步动作提示

#### Scenario: 控制面展示 Go runner 失败

- **WHEN** Go runner 的 `state.json.status` 为 failed 或 aborted
- **THEN** 工作流详情 read model MUST 展示该阶段的失败或中止状态
- **AND** 错误摘要来自 runner state 的 `error`
- **AND** 系统不得把失败状态伪装成 pending 或 completed

#### Scenario: 控制面展示恢复后的内部会话

- **WHEN** 用户恢复一个未完成的 Go run
- **THEN** 后端 MUST 调用 `mc resume --run-id <run-id> --json`
- **AND** 工作流详情 read model MUST 重新从 runner `state.json` 派生阶段和 artifact
- **AND** 系统 MUST 不得通过旧 Node 内存 action key 推进阶段

### Requirement: 工作流详情页必须展示 Go runner 进程列表

系统 MUST 在工作流详情页展示 Go-backed workflow 的阶段进程列表，让用户能看到每个阶段的运行状态、关联会话和日志入口。

#### Scenario: 工作流详情页显示阶段进程

- **WHEN** 用户打开 Go-backed workflow 详情页
- **AND** workflow read model 包含 `runnerProcesses`
- **THEN** 页面显示进程列表
- **AND** 每个进程行显示 stage 和 status
- **AND** 有 sessionId 的进程行提供会话链接
- **AND** 有 logPath 的进程行提供日志链接

#### Scenario: 点击进程会话进入 workflow child route

- **WHEN** 用户在工作流详情页点击某个 runner 进程的会话链接
- **THEN** 系统导航到该 workflow 下的 `/runs/<runId>/sessions/<stage>` 子会话路由
- **AND** 不导航到项目级 `/cM` 手动会话路由

### Requirement: 手动会话列表必须排除工作流拥有的会话

系统 MUST 在所有手动会话入口排除 workflow-owned sessions，包括由 Go runner 发起或恢复的 Codex 会话。

#### Scenario: 项目主页不显示工作流子会话

- **WHEN** 项目存在 Go-backed workflow
- **AND** 该 workflow 的 read model 包含 runner-owned child session
- **THEN** 项目主页“手动会话”列表不显示该 session
- **AND** 该 session 仍可从 workflow 详情页进入

#### Scenario: 项目内导航不显示工作流子会话

- **WHEN** 用户打开项目内导航
- **AND** 项目存在 runner-owned child session
- **THEN** 项目内导航的“手动会话”分组不显示该 session

#### Scenario: 左侧栏不显示工作流子会话

- **WHEN** 用户展开左侧项目
- **AND** 项目存在 runner-owned child session
- **THEN** 左侧栏的“手动会话”分组不显示该 session

#### Scenario: 项目级会话路由不解析工作流子会话

- **WHEN** 用户直接访问项目级 `/cM`
- **AND** `cM` 对应的是 workflow-owned child session
- **THEN** 系统不把它解析为普通手动会话
- **AND** 用户必须通过 workflow 详情页或 `/runs/<runId>/sessions/<stage>` 查看该会话

### Requirement: 需求工作流阶段缩略图必须支持跳转或高亮阶段

系统 MUST 让桌面端需求工作流详情页右上角的阶段缩略图成为真实交互入口，而不是静态装饰。点击阶段节点时，若该阶段已有对应子会话，系统 MUST 跳转到该子会话；若该阶段还没有子会话，系统 MUST 保持在详情页并高亮对应阶段块。

#### Scenario: 点击已有子会话的阶段节点
- **WHEN** 用户在桌面端工作流详情页点击某个已经存在子会话的阶段节点
- **THEN** 系统跳转到该阶段对应的子会话页
- **AND** 当前路由仍保持在该项目工作区作用域下

#### Scenario: 点击尚无子会话的阶段节点
- **WHEN** 用户在桌面端工作流详情页点击某个尚未生成子会话的阶段节点
- **THEN** 系统不会离开当前工作流详情页
- **AND** 正文区高亮该阶段的说明、状态或阻塞原因

### Requirement: 手动会话详情不得展示工作流阶段缩略图

系统 MUST 只在需求工作流详情页展示阶段缩略图。用户进入手动会话详情页时，页面不得继续显示工作流阶段缩略图，以免把手动会话误导成控制面流程的一部分。

#### Scenario: 打开手动会话详情页
- **WHEN** 用户进入某个项目中的手动会话详情页
- **THEN** 页面显示该手动会话内容
- **AND** 右上角不会显示需求工作流的阶段缩略图

### Requirement: 控制面业务逻辑必须整体迁入 CCUI 服务端

系统 MUST 在 CCUI 内持有需求工作流 Web 控制面持久化、artifact 回链和验收门禁展示语义；自动调度和阶段推进 MUST 委托给 Go runner。

#### Scenario: 刷新后保留工作流控制面状态
- **WHEN** 某个需求工作流已经进入 planning、execution 或 verification 阶段
- **AND** 用户刷新页面或重新打开 CCUI
- **THEN** 工作流详情仍能显示上次持久化的 run id、阶段、运行状态和相关 artifact
- **AND** 这些状态来自 workflow 记录和 `.ccflow/runs/<run-id>/state.json`

### Requirement: 项目排序必须保持字母序稳定

系统 MUST 以项目显示名的字母序作为默认排序，不得因为会话消息、工作流推进或后台执行时间刷新而改变项目顺序。

#### Scenario: 项目列表保持字母序并以绿点提示未读活动
- **WHEN** 两个或多个项目同时存在
- **AND** 其中一个项目收到新的手动会话消息或需求工作流状态更新
- **THEN** 项目列表顺序仍按字母序保持稳定
- **AND** 有未查看新活动的项目显示绿色圆点提示
- **AND** 系统不会把该项目自动移动到列表顶部

### Requirement: 未读提示必须覆盖手动会话与需求工作流

系统 MUST 将手动会话的新消息和需求工作流的新阶段更新都计入项目未读状态，直到用户进入相应内容完成查看。

#### Scenario: 查看后清除项目未读绿点
- **WHEN** 某个项目因为需求工作流更新而显示绿色圆点
- **AND** 用户进入该需求工作流详情并查看最新状态
- **THEN** 该项目的未读绿点被清除
- **AND** 其他仍未查看活动的项目继续保留各自的绿点状态

### Requirement: 项目主页手动会话控制面不得截断已加载会话

系统 MUST 在项目主页的“手动会话”控制面展示该项目全部已加载且未隐藏的手动会话，不能因为固定卡片上限只显示前 5 条。

#### Scenario: 项目主页展示超过 5 个手动会话
- **WHEN** 某个项目存在 7 个已加载且未隐藏的手动会话
- **AND** 用户进入该项目主页并展开“手动会话”区域
- **THEN** 控制面显示 `7 个可直接进入的会话`
- **AND** 用户可以直接看到全部 7 个会话卡片
- **AND** 不需要先隐藏或删除前面的会话卡片才能看到后续会话

### Requirement: 工作流控制面必须从 mc run state 派生

系统 MUST 将自动工作流的 identity、阶段、runner 进程、产物和内部会话入口从 `.ccflow/runs/<run-id>/state.json` 派生。项目 `conf.json` 不得保存 workflow 镜像索引，也不得用 `.ccflow/conf.json.workflows` 决定工作流是否存在。

#### Scenario: 新建工作流时显示 mc run

- **WHEN** 用户在 WebUI 中创建项目的第一个工作流
- **THEN** 后端调用 `mc run --change <change-name> --json`
- **AND** 前端从 `.ccflow/runs/<run-id>/state.json` 看到该工作流
- **AND** 项目 `conf.json` 不写入 `workflows["1"]` 或 `workflowId`

#### Scenario: 工作流内部会话按 runner stage 暴露入口

- **WHEN** runner state 中记录 planning、execution 或 review 子会话
- **THEN** 工作流详情按阶段或角色展示对应入口
- **AND** 子会话路由使用 `/<project>/runs/<runId>/sessions/<stage>`
- **AND** 这些 runner-owned 子会话不写入项目 `conf.json.workflows`

### Requirement: 工作流内部会话不得占用手动会话编号

系统 MUST 将 runner-owned 工作流内部会话与 WebUI 手动会话分离。工作流内部会话不得写入顶层 `chat`，也不得推进手动会话 `cN` 编号。

#### Scenario: runner-owned 子会话不推进手动会话编号

- **WHEN** 一个 mc 工作流 state 已经包含两个 runner-owned 子会话
- **AND** 顶层 `chat` 为空
- **AND** 用户在 WebUI 新建普通会话
- **THEN** 系统创建 `chat["1"]`
- **AND** 系统不会因为工作流内部会话而创建 `chat["3"]`

### Requirement: Go-backed 工作流自动阶段必须固定为 Codex

系统 MUST 在工作流创建和详情页中明确 Go runner 自动阶段由 Codex 执行。旧阶段 provider 配置入口不得影响 Go-backed workflow，也不得让系统回退到 Node/Claude 自动推进。

#### Scenario: 创建工作流时提交旧 provider 配置

- **WHEN** 创建请求体中包含 `stageProviders`
- **THEN** 后端创建的 Go-backed workflow 仍写入 `runnerProvider: "codex"`
- **AND** 配置文件不保留旧 provider 覆盖
- **AND** 工作流详情页展示 Codex 作为 runner provider

#### Scenario: 详情页查看未启动阶段

- **WHEN** 用户查看 Go-backed workflow 详情页
- **AND** 某个自动阶段尚未开始
- **THEN** 阶段标题旁显示 Codex provider 信息
- **AND** 页面不提供可切换到 Claude/OpenCode 自动阶段的控件

### Requirement: 项目主页会话卡片 UI 状态必须持久化

系统 MUST 将项目主页普通手动会话卡片的收藏、待办、隐藏状态持久化到项目 `conf.json` v2 的对应 `chat[].ui` 记录，并在项目刷新后重新回填到会话卡片。

#### Scenario: 收藏普通手动会话后刷新仍保留

- **WHEN** 用户在项目主页右键一个普通手动会话卡片
- **AND** 点击“收藏”
- **THEN** 该会话卡片显示“收藏”状态
- **WHEN** 用户刷新项目列表或重新打开项目主页
- **THEN** 该会话卡片仍显示“收藏”状态
- **AND** 项目 `conf.json` 对应 `chat` 记录包含 `ui.favorite: true`

#### Scenario: 取消收藏普通手动会话后清理空 UI 状态

- **WHEN** 一个普通手动会话已经处于收藏状态
- **AND** 用户在项目主页右键该会话卡片并点击“取消收藏”
- **THEN** 该会话卡片不再显示“收藏”状态
- **AND** 如果该会话没有其他 UI 状态，系统从对应 `chat` 记录中移除空的 `ui` 字段

### Requirement: 隐藏会话必须可以从项目主页恢复

系统 MUST 在项目主页支持隐藏普通手动会话，并提供“显示已隐藏项”入口让用户重新显示和取消隐藏。

#### Scenario: 隐藏普通手动会话后出现恢复入口

- **WHEN** 用户在项目主页右键一个普通手动会话卡片
- **AND** 点击“隐藏”
- **THEN** 该会话卡片从默认手动会话列表中消失
- **AND** 项目主页显示“显示已隐藏项”入口
- **AND** 项目 `conf.json` 对应 `chat` 记录包含 `ui.hidden: true`

#### Scenario: 显示已隐藏项后取消隐藏

- **WHEN** 项目存在至少一个隐藏的普通手动会话
- **AND** 用户点击“显示已隐藏项”
- **THEN** 隐藏会话在项目主页中重新出现
- **WHEN** 用户右键该隐藏会话并点击“取消隐藏”
- **THEN** 该会话回到默认手动会话列表
- **AND** 再次刷新项目主页后仍可见

### Requirement: 项目主页排序控件必须避免文字与下拉箭头重叠

系统 MUST 在项目主页保留工作流与手动会话排序控件，并确保排序选项文字不会与浏览器原生下拉箭头重叠。

#### Scenario: 项目主页排序控件可读

- **WHEN** 用户打开项目主页
- **THEN** “工作流排序”和“手动会话排序”控件仍然可见
- **AND** 每个控件的当前选项文字完整可读
- **AND** 当前选项文字不会覆盖下拉箭头区域

### Requirement: 工作流列表必须展示已接管的外部 mc run

系统 MUST 在项目 workflow 列表中展示从 `.ccflow/runs/*/state.json` 接管的外部 `mc` run，使用户能从 Web UI 查看其他终端启动或完成的工作流。

#### Scenario: 列表展示外部运行中工作流
- **WHEN** 用户在其他终端启动 `mc`
- **AND** 该 run 已写入 `.ccflow/runs/<run-id>/state.json`
- **AND** 用户打开或刷新项目 workflow 列表
- **THEN** 列表 MUST 显示该 workflow
- **AND** 该 workflow MUST 显示为 Go runner-backed running 状态

#### Scenario: 列表展示外部已完成工作流
- **WHEN** 外部 `mc` run 的 state 为 done 或 completed
- **AND** 该 run 未通过 Web UI 创建 workflow
- **THEN** 项目 workflow 列表 MUST 仍显示该 completed workflow
- **AND** 用户 MUST 能进入详情页查看 runner state 和 artifact 链接

#### Scenario: 接管后 route 稳定
- **WHEN** 外部 run 第一次被 workflow 列表发现
- **AND** 用户刷新页面或重启 ccflow 服务
- **THEN** 该 workflow 的 `/runs/<runId>` route MUST 保持稳定
- **AND** 系统 MUST NOT 因重复 discovery 创建重复 workflow 卡片

#### Scenario: 详情页展示接管来源
- **WHEN** 用户打开外部 run 对应的 workflow 详情页
- **THEN** 详情页 MUST 展示 run id、OpenSpec change、当前 stage 和 runState
- **AND** 系统 SHOULD 提供该 workflow 来自外部 `mc` run 接管的诊断信息

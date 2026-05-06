## 修改需求

### 需求：需求工作流详情必须展示 Go runner 控制面状态

系统必须把 Go runner 的 run 状态映射到既有工作流详情 read model，包括阶段状态、artifact 链接、内部运行日志、失败原因和可恢复动作。

#### 场景：展示 Go runner 阶段状态
- **当** 用户打开一个 `runner: "go"` 的 workflow 详情页
- **则** 系统读取 workflow 记录的 `runId`
- **则** 系统从 `.ccflow/runs/<run-id>/state.json` 派生阶段树
- **则** 当前阶段、已完成阶段和失败/中止状态与 runner 状态一致

#### 场景：展示 Go runner artifacts
- **当** Go runner 已生成 review JSON、repair summary 或 delivery summary
- **则** 工作流详情页展示这些 artifact 的链接
- **则** 链接目标来自 runner `state.json.paths` 或约定 run 目录
- **则** 系统不得伪造不存在的 artifact 为已完成

#### 场景：展示 runner 失败
- **当** Go runner 返回错误或 `state.json.status` 为失败/中止
- **则** 工作流详情页展示失败 stage、错误摘要和可执行的恢复或重新采用动作
- **则** 系统不得把失败状态映射为 pending 或 completed

### 需求：旧 Node workflow 不得继续自动推进

系统必须停用旧 Node/TS auto-runner，不再为旧 workflow 自动推进、修复、审核或归档。

#### 场景：旧 workflow 不再自动运行
- **当** workflow 没有 Go `runId`
- **且** workflow 存在旧 stage status 或 child session 状态
- **则** 系统不启动旧 Node auto-runner
- **则** 系统提示用户基于 active OpenSpec change 重新启动 Go runner

#### 场景：删除旧自动状态机入口
- **当** 后端启动
- **则** 旧 Node auto-runner 不注册后台 reconcile timer
- **则** 旧 `completedKeys` / `inFlightKeys` 状态不再参与工作流推进判断

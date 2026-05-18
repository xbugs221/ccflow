# 规格

### 需求：规划会话必须按 wo planner 角色读取

cbw 必须把 `wo` 当前契约中的 planner role 作为规划会话主来源，不得只读取 planning key。

#### 场景：读取 codex planner 规划会话

- **给定** `wo state.json` 中存在 `sessions["codex:planner"] = "planner-thread-1"`
- **当** 用户打开 workflow 详情页
- **则** 规划行显示可进入的“会话”
- **且** 点击后进入该 run 的 planning child session route
- **并且** read model 中规划 sessionRef 的 `sessionId` 是 `planner-thread-1`

#### 场景：读取非 Codex planner 规划会话

- **给定** planning 阶段配置的 tool 是 `pi`
- **且** `wo state.json` 中存在 `sessions["pi:planner"] = "pi-planner-1"`
- **当** cbw 构造 workflow read model
- **则** 规划行 sessionRef 的 provider 是 `pi`
- **且** session id 是 `pi-planner-1`
- **并且** 不得错误回退为 Codex provider

#### 场景：兼容历史 planning key

- **给定** 旧运行态中只存在 `sessions["codex:planning"] = "legacy-planning-thread"`
- **当** 用户打开 workflow 详情页
- **则** cbw 仍能显示规划会话入口
- **但** 新增测试和 fixture 的主路径必须使用 `codex:planner`

#### 场景：规划会话缺失

- **给定** `wo state.json` 中没有 planner/planning 会话 id
- **当** 用户打开 workflow 详情页
- **则** 规划行显示 `未知`
- **且** 不得用 run id、stage key 或 log 文件名伪造会话 id

### 需求：runnerProcesses 只能表达真实进程事实

cbw 不得从 `state.sessions` 或 stage 状态合成 runner process rows。没有真实 process 数据时，进程区必须隐藏。

#### 场景：sessions-only 状态不显示进程区

- **给定** `wo state.json` 中存在 `sessions["codex:planner"]` 和 `sessions["codex:executor"]`
- **且** `state.processes` 不存在或为空
- **当** 用户打开 workflow 详情页
- **则** 角色摘要仍显示对应会话入口
- **但** 页面不显示 `workflow-runner-processes` 进程区
- **并且** read model 的 `runnerProcesses` 为空数组

#### 场景：真实 processes 保留 pid

- **给定** `wo state.json` 中存在：

```json
{
  "processes": [
    {
      "stage": "execution",
      "role": "executor",
      "status": "running",
      "session_id": "executor-thread-1",
      "pid": 4321
    }
  ]
}
```

- **当** cbw 构造 workflow read model
- **则** `runnerProcesses[0].pid` 是 `4321`
- **且** `runnerProcesses[0].sessionId` 是 `executor-thread-1`
- **并且** 前端展示时不得把 `executor-thread-1` 当作 pid

#### 场景：process 没有 pid 不得伪造

- **给定** `state.processes[0].session_id = "reviewer-thread-1"`
- **且** 该 process 没有 `pid`
- **当** 用户查看进程区
- **则** 页面可以显示 `thread=reviewer-thread-1`
- **但** 不得显示 `pid=reviewer-thread-1`
- **并且** 不得把 session id 称为进程编号

### 需求：会话编号和进程编号在 UI 上语义分离

workflow UI 必须让用户能区分 provider 会话编号和系统进程编号。

#### 场景：角色行展示会话编号入口

- **当** workflow 角色摘要展示 `规`、`写`、`审`、`修` 或 `存` 的会话入口
- **则** 这些入口表示 provider session id
- **且** 点击进入对应 workflow child session
- **并且** 不得暗示它是 pid

#### 场景：进程行展示 process metadata

- **当** workflow 详情页展示真实进程行
- **则** pid 只来自 `process.pid`
- **且** thread/session 只来自 `process.sessionId`
- **并且** 二者应分开渲染或分开命名

### 需求：测试 fixture 必须贴近真实 wo 契约

cbw 的 workflow 测试数据必须使用当前 `wo` 的 role key，避免测试通过但真实运行态失败。

#### 场景：fixture 使用 codex:planner

- **当** Playwright fixture 或 server read model 测试需要构造规划会话
- **则** 主路径必须写入 `sessions["codex:planner"]`
- **且** 不得只写 `sessions["codex:planning"]`

#### 场景：旧 fixture 预期被更新

- **当** 测试断言 workflow runner process 区
- **则** 只有 fixture 显式提供 `processes` 时才断言进程区存在
- **并且** sessions-only fixture 应断言进程区不存在

## 背景

当前代码把“Web 控制面”和“自动执行器”混在一起：

- `server/workflows.js` 同时负责 workflow store、read model、artifact 探测、OpenSpec change 绑定和 Go runner state overlay。
- `server/workflow-auto-runner.js` 负责旧 Node 自动推进，内部创建 provider 子会话并根据内存 action key 决定下一阶段。
- `server/domains/workflows/go-runner-client.js` 已经能调用 `mc`，但旧执行器仍可能存在于启动、恢复或历史 workflow 路径中。

目标形态是单向依赖：

```text
React UI
  -> ccflow HTTP/WebSocket control plane
    -> workflow read model/routes
      -> Go runner adapter
        -> mc run/resume/status/abort --json
          -> .ccflow/runs/<run-id>/state.json
```

ccflow 不再根据 Node 内存状态推进 execution/review/repair/archive，也不再自己创建自动阶段 provider 会话。它只把 `mc` sealed state 映射为 Web 可读模型。

## 决策

### 1. `mc` 是唯一自动工作流执行器

所有自动 workflow 动作都通过 `go-runner-client` 进入 `mc`：

- 创建：`mc run --change <change> --json`
- 恢复：`mc resume --run-id <run-id> --json`
- 查询：`mc status --run-id <run-id> --json` 或直接读取 state file
- 中止：`mc abort --run-id <run-id> --json`

旧 TS auto-runner 的 action 解析、stage prompt 拼装、review/repair 决策和 provider 子会话创建必须删除。相关测试、fixtures 和文档如果只服务旧执行器，也一并删除。

### 2. 缺少 `mc` 是显式错误，不是降级条件

服务启动或首次访问 workflow 能力时必须执行 `mc contract --json` 检查。检查失败时：

- Runtime diagnostics 显示失败原因。
- 创建/恢复/中止 workflow 接口返回明确错误。
- 系统不得启动旧 TS runner 作为 fallback。

这让部署问题暴露在边界上，而不是在前端表现为“没有 workflow”或“阶段卡住”。

### 3. JSON 字段职责按事实来源合并

工作流信息不要在多个 JSON 文件里重复保存同一事实。字段合并规则如下：

```text
.ccflow/conf.json
  不再保存 workflows 索引。
  本变更不新增 workflow UI 偏好表。

.ccflow/runs/<run-id>/state.json
  保存 mc runner 拥有的运行事实，也是 workflow 列表的唯一来源。

GET /api/projects* 返回的 ProjectWorkflow
  后端扫描 runs 目录并运行时生成前端 read model。
```

因此本变更不保留 `.ccflow/conf.json.workflows`。保留它的唯一价值本来是给旧 `/wN` 路由和 UI 状态提供稳定索引，但这会重新制造一个 `mc` 不会写、ccflow 必须维护的镜像索引。新的规则是：

- workflow identity 直接使用 `runId`。
- workflow 路由改为 runId-based，例如 `/projects/:projectName/runs/:runId`。
- workflow 子会话路由使用 runId + role/sessionId，例如 `/projects/:projectName/runs/:runId/sessions/:role`。
- title/objective 使用 runner `change_name`。本变更不做 Web 侧 workflow 重命名。
- favorite、pending、hidden 等 workflow UI 偏好不在本变更中保留。

`.ccflow/conf.json` 不得保存这些 workflow 镜像字段：

- `stage`
- `runState`
- `stageState`
- `stageStatuses`
- `runnerProcesses`
- `artifacts`
- `sessions`
- `chat`
- `controllerEvents`
- `runnerError`
- `runId` 列表
- `wN` routeIndex

这些字段必须从 `.ccflow/runs/<run-id>/state.json` 派生。这样前端能拿到足够信息，同时不会出现 conf 和 state 互相覆盖。

### 4. 前端 read model 字段

后端返回给前端的 `ProjectWorkflow` 应该包含完整展示所需信息，但这些信息大多是运行时合并结果：

- identity：`id`、`title`、`objective`、`runner: "go"`、`runId`、`openspecChangeName`
- state：`stage`、`runState`、`updatedAt`、`failureReason`、`runnerError`
- progress：`stageStatuses`
- processes：`runnerProcesses[]`，包含 `stage`、`role`、`status`、`sessionId`、`logPath`、可选 `pid/exitCode/failed`
- sessions：`childSessions[]`，由 runner `sessions` 派生，使用 role/sessionId 生成稳定入口
- artifacts：`artifacts[]`，由 runner `paths`、review JSON、repair summary、delivery summary 等文件存在性派生
- diagnostics：`controlPlaneReadModel` 可放 runner contract、state path、raw status、baseline diff 摘要等排障信息

建议合并优先级：

```text
id                    <- runId
route                 <- runId-based route
runId                 <- .ccflow/runs/<run-id> directory name or state.run_id
title/objective       <- state.change_name
stage/runState/error   <- state.json
progress/processes     <- state.json
artifacts              <- state.json.paths + 文件存在性
child session routes   <- state.json.sessions role/sessionId
```

### 5. 不做旧 Node workflow 兼容

旧 `.ccflow/conf.json.workflows` 不再被读取为 workflow 来源。清理逻辑可以删除整个 `workflows` 分组。这样比“清理缺 runId 的记录”更彻底，也避免未来继续把 conf 当作 workflow 真相。

### 6. 前端控件收敛到 runner 事实

工作流创建和详情页不再提供能够影响自动执行器类型的 stage provider 切换。UI 可以展示 `runnerProvider`、`mc` version、run id、stage、artifact，但不能把 Claude/OpenCode/Node provider 当作 Web 侧可切换的自动阶段执行器。

### 7. 删除顺序

推荐拆分实现步骤：

1. 加保护测试，证明创建/恢复/中止只走 fake `mc`。
2. 从 `server/index.js` 和相关 route 中移除 `workflow-auto-runner` 调度入口。
3. 删除 `server/workflow-auto-runner.js` 及只服务旧 TS runner 的 prompt/action/review helper。
4. 清理前端 stage provider 配置入口。
5. 删除无调用的旧 runner 测试、fixtures、docs。
6. 改造路由和 read model：workflow list 从 `.ccflow/runs/*/state.json` 扫描生成，URL 使用 runId。
7. 固化“没有 `conf.json.workflows` 也能显示 mc 工作流”的测试。

这样可以避免一次性删除大量代码后难以判断行为回归来源。

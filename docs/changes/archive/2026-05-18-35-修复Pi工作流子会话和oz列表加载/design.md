# 设计

## 当前判断

本次分析检查了当前项目的真实 wo state 和 cbw read model：

```text
state.sessions
  pi:executor -> 019e368b-3396-765c-9b90-3e32fc5d3179

cbw read model
  workflowOwnedSessions: contains pi executor
  workflowRoleSummary.executor.sessionRef: provider=pi
  childSessions: []
  runnerProcesses: [{ stage: execution, role: executor, status: running }]
```

这说明 cbw 已能解析 provider prefix，但只把它用于 diagnostics 和 role summary。真正驱动 workflow child route、stage inspection 和消息页上下文的 `childSessions` 没有从 provider-aware `state.sessions` 构造。

active oz changes 的耗时也已定位：

```text
server/index.ts /openspec/changes
  -> attachWorkflowMetadata(await getProjects())
  -> findProjectByName(...)
  -> listProjectAdoptableOpenSpecChanges(project)
     -> listProjectWorkflows(projectPath)
     -> oz list --json
```

其中 `getProjects()` 在当前机器约 2.7s，后续真正 list workflow 和 oz list 只有毫秒级。弹窗需要的是“当前项目还有哪些 active change 没被 workflow claim”，不需要刷新全项目 sidebar 数据。

## 决策 1：sessions role map 生成 child sessions

新增集中转换：

```text
buildChildSessions(runId, explicitProcesses, sessions, workflowConfig)
  explicit process with sessionId
    -> child session, process-backed
  provider role map entry
    -> child session, session-backed
  merge by provider + sessionId
```

role 到 stage 的映射应按 wo 固定角色和 key 规则：

```text
planner/planning -> planning
executor         -> execution
reviewer         -> first active/completed review_N, fallback review_1
fixer            -> first active/completed fix_N/repair_N, fallback fix_1
archiver         -> archive
stage key entry  -> that stage key
```

provider 来自 `parseProviderSessionKey(key)`。如果 key 没有 provider，按历史兼容回退为 `codex`。未知 provider 可保留 unlinked 语义，但 `codex`、`opencode`、`pi` 必须能作为可导航 child session。

## 决策 2：runnerProcesses 不再承载 sessions-only 事实

34 号提案已经要求 `runnerProcesses` 只表达真实 process 数据。本提案执行时应同步落实：

```text
state.processes absent
  runnerProcesses = []
  childSessions = from state.sessions

state.processes present
  runnerProcesses = normalized explicit processes
  childSessions = merge(process.sessionId, state.sessions)
```

这样页面可以同时满足：

- 子会话可进入。
- 角色摘要能显示“会话”。
- 进程区不会把 role session id 误称为 pid。

## 决策 3：Pi child session 消息按 co read model 加载

Pi 没有 Codex JSONL 文件，也不像 OpenCode 那样通过本地 session 目录索引。它的 durable history 应来自 co conversation：

```text
Workflow child route
  session.id = provider session id from wo
  provider = pi
  workflowId = run id
  stageKey/address = derived from role/stage

Message API
  provider=pi
  find co conversation by provider_session_id or conversation_id
  read co turns/events into messages
```

如果 wo 只记录了 Pi provider session id，但 co conversation 尚不存在，消息接口应返回稳定的空结果或明确错误状态，不能 fallback 到 Codex session file lookup。前端应保留 workflow child-session 上下文，避免刷新后变成普通 `/cN` 或 Codex 视图。

## 决策 4：active changes API 走轻量项目解析

新增或复用轻量项目解析函数：

```text
resolveProjectForName(projectName)
  -> current project fullPath/path/name
  -> no provider session population
  -> no attachWorkflowMetadata
```

`/api/projects/:projectName/openspec/changes` 应只做：

```text
projectPath = resolve projectName to path
claimed = listProjectWorkflows(projectPath).map(openspecChangeName)
changes = oz list --json in projectPath
return changes - claimed
```

如果需要避免重复读取 workflow，可让 `listProjectAdoptableOpenSpecChanges` 接受已知 workflow read models，或者增加 `listAdoptableOpenSpecChangesForPath(projectPath)`。不要在这个请求里刷新所有项目、所有 provider 会话和 sidebar metadata。

## 风险

- 风险：历史 state 中 `sessions.executor` 没有 provider prefix。
  - 处理：继续按 Codex 兼容。

- 风险：role 到 stage 的推断在多轮 review/fix 中选错。
  - 处理：优先匹配 stages 中已 active/completed 的具体 stage；同 role 多 session 时用 `by-id/<sessionId>` address 避免冲突。

- 风险：Pi provider session id 与 co conversation id 不一致。
  - 处理：消息加载先按 `provider_session_id` 查 co conversation，再按 `conversation_id` 查；找不到时不跨 provider fallback。

- 风险：优化 active changes API 后项目名解析不完整。
  - 处理：复用现有项目发现中的 name/path 映射逻辑，但只读基础项目记录，不填充 provider sessions。

## 测试设计

- `tests/server/wo-workflow-contract.test.ts` 或新增 server 测试：构造 `sessions: {"pi:executor": "pi-thread-1"}`、无 `processes`，断言 `childSessions[0]` 可路由且 `runnerProcesses` 为空。
- `tests/server/wo-pi-read-model.test.ts`：覆盖 role summary、stage inspection agentSessions 和 diagnostics 三处都能看到 Pi child session。
- `tests/spec/project-workflow-child-session-isolation.spec.ts` 或新增 spec：打开 workflow 详情，点击 Pi executor 会话，断言 URL 是 workflow child route，聊天加载 provider 是 `pi`。
- `tests/server` 中补消息 API 测试：伪造 co conversation state/events，调用 provider=pi 的 session messages，断言返回 co durable messages。
- `tests/server` 或 spec 中补 active changes 轻量路径测试：mock/spy `getProjects` 或构造大量 provider sessions，断言 `/openspec/changes` 不依赖全项目 provider session 扫描。

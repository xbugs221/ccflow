# 修复 Pi 工作流子会话和 oz 列表加载

## 问题

当前项目已有一个正在运行的 wo run：

```text
~/.local/state/wo/repos/cbw-97555dec0f/runs/20260517T152552.426516978Z/state.json
sessions["pi:executor"] = "019e368b-3396-765c-9b90-3e32fc5d3179"
processes = absent
```

cbw read model 能在角色摘要里看到 `pi:executor`，但 `childSessions` 为空，阶段检查里的 `agentSessions` 也为空。原因是 `server/domains/workflows/wo-read-model.ts` 目前把 child session 主要建立在 `runnerProcesses` 上，而 sessions-only fallback 只查 `sessions[role]`、`sessions["codex:<role>"]` 和历史 `claude` key，没有把 `pi:<role>`、`opencode:<role>` 这些 provider-aware role map 当作可路由子会话来源。

这会导致 Pi 发起的 workflow 会话在网页上只能看到一个孤立的 role sessionRef，进入后缺少完整 workflow child-session 上下文，进一步影响消息加载、阶段归属和路由刷新。

另一个问题是新建工作流弹窗读取 active oz changes 明显慢。实测：

```text
oz list --json                              ~2ms
listProjectWorkflows(current project)       ~7ms
listProjectAdoptableOpenSpecChanges         ~6ms
GET /openspec/changes 等价链路              ~2.7s
```

慢点不在 `oz list`，而在 `/api/projects/:projectName/openspec/changes` 先执行 `attachWorkflowMetadata(await getProjects())`。这个路径会重建全项目列表、扫描多个 provider 会话和 sidebar 级 read model，然后才找到当前 project，再执行本来很快的 oz list。

## 目标

- 将 `wo state.sessions` 中的 provider-prefixed role map 作为 workflow child session 的一等来源，覆盖 `pi:executor`、`pi:fixer`、`opencode:executor`、`codex:reviewer` 等真实 role key。
- 没有真实 `state.processes` 时仍能生成子会话入口、角色摘要和 stage agent session，但不得把 sessions-only 数据伪造成 runner process。
- Pi workflow child session 打开后，路由必须携带 `provider=pi`、`workflowId`、`stageKey/address`，消息加载应按 co conversation/read model 查找，而不是退回 Codex 或普通手动会话。
- 优化 active oz changes API：只解析当前项目路径、读取当前项目 workflow claim、调用 `oz list --json`，不得为了弹窗列表重建全项目 provider 会话索引。

## 范围

- 修改 `server/domains/workflows/wo-read-model.ts` 的 child session 构造，让 `state.sessions` provider role map 直接生成 child sessions，并与 explicit `processes` 去重合并。
- 保持 34 号提案要求：`runnerProcesses` 只能来自真实 process 数据，不再由 sessions-only fallback 伪造。
- 修改 workflow 路由解析和前端导航，使 role summary、display line、stage inspection 都能进入 provider-aware workflow child route。
- 修改 `/api/projects/:projectName/openspec/changes` 服务端路径，避免调用全量 `getProjects()` + `attachWorkflowMetadata()`。
- 补充真实业务测试，覆盖 Pi workflow 子会话消息加载和新建工作流弹窗的性能契约。

## 非目标

- 不修改 wo CLI 或 wo state.json 契约。
- 不改变 33 号提案中 co/wo 作为权威 read model 的方向。
- 不把 role session id 当作 pid；pid 仍只来自真实 process 数据。
- 不重做工作流页面样式。
- 不要求 `oz list` 本身做缓存或改造。

## 与现有提案关系

- 33 号提案解决聊天消息渲染和运行态不要在前端复制 co/wo 状态机；本提案只补足 workflow child session 能否按 provider 正确进入和读取消息。
- 34 号提案解决 planner key、pid/session 语义混淆和 process rows 伪造；本提案延续 34 的方向，但把范围从 planner 扩展到所有 provider-aware role sessions，尤其是当前已经复现的 `pi:executor`。

## 测试策略

执行阶段需要在 `docs/changes/35-修复Pi工作流子会话和oz列表加载/tests/` 写真实测试代码，再按来源迁移到根 `tests/`。测试必须覆盖业务行为：

- server read model：sessions-only 的 `pi:executor` 生成 `childSessions`，provider 是 `pi`，stageKey 是 `execution`，但 `runnerProcesses` 为空。
- server read model：explicit `processes` 与 `state.sessions` 同时存在时，同一个 session 不重复生成 child session，pid 与 session id 保持分离。
- 前端/路由：点击 workflow role summary 里的 Pi 会话后进入 `/runs/<run>/sessions/<address>`，selected session 的 `__provider` 是 `pi`，不是 Codex。
- 消息加载：Pi workflow child session 调用 `/sessions/<id>/messages?provider=pi`，能从 co conversation/read model 读出用户消息和 assistant 消息；没有 co conversation 时显示明确空态或错误，不静默退回 Codex。
- active changes API：打开新建工作流弹窗只调用当前项目 active changes 路径，不触发全项目 provider session 扫描；在测试夹具中 `oz list` 快速返回时，接口不应被 `getProjects()` 拖到秒级。

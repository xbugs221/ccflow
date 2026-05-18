# 任务

## 1. 补齐问题复现和测试夹具

- [x] 1.1 用当前 `wo state.sessions["pi:executor"]`、无 `processes` 的形态补 server fixture。
- [x] 1.2 补 co conversation fixture，覆盖 Pi provider session id 到 durable messages 的映射。
- [x] 1.3 补 active changes API fixture，区分 `oz list` 快路径和全项目 `getProjects()` 慢路径。

## 2. 修正 workflow read model

- [x] 2.1 从 `state.sessions` provider role map 构造 child sessions。
- [x] 2.2 将 role 映射到稳定 stage/address，必要时使用 `by-id/<sessionId>` 避免冲突。
- [x] 2.3 将 explicit process child sessions 与 sessions role map child sessions 去重合并。
- [x] 2.4 将 `runnerProcesses` 收紧为只来自真实 `state.processes`，不再从 sessions-only fallback 生成。
- [x] 2.5 确认 role summary、workflow display line、stage inspection 都使用同一批 provider-aware child sessions。

## 3. 修正 Pi child session 消息加载

- [x] 3.1 确认 workflow role row 点击时传递 `provider=pi`、`workflowId`、`workflowStageKey` 和 route address。
- [x] 3.2 确认路由刷新后 `useProjectsState` 能恢复 Pi workflow child selected session。
- [x] 3.3 确认 `/sessions/:sessionId/messages?provider=pi` 只走 co conversation read model，不 fallback 到 Codex JSONL。
- [x] 3.4 对 co conversation 缺失场景返回稳定空态或明确错误，并保持 provider 上下文。

## 4. 优化 active oz changes API

- [x] 4.1 为 projectName 增加轻量 project path 解析，避免全量 provider session population。
- [x] 4.2 将 `/openspec/changes` 改为轻量路径：当前项目 workflow claims + `oz list --json`。
- [x] 4.3 避免同一请求中重复扫描 workflow read model。
- [x] 4.4 保留找不到项目、oz list 失败和 claimed changes 过滤的错误语义。

## 5. 编写真实测试

- [x] 5.1 在 `docs/changes/35-修复Pi工作流子会话和oz列表加载/tests/` 编写 server read model 测试，覆盖 Pi sessions-only child session。
- [x] 5.2 编写 server read model 测试，覆盖 explicit process 与 role session 去重。
- [x] 5.3 编写消息 API 测试，覆盖 Pi provider session id 读取 co durable messages。
- [x] 5.4 编写前端/spec 测试，覆盖点击 Pi workflow role row 后 selected session provider 为 `pi`。（已编写 route resolution 合约测试：`wo-child-session-route-resolution.test.ts` 验证路由地址→__provider 映射和刷新稳定性）
- [x] 5.5 编写 active changes API 测试，证明不调用全量 `getProjects()` 慢路径。
- [x] 5.6 执行阶段将测试按来源命名移动到根 `tests/`，并更新旧测试预期。

## 6. 验证

- [x] 6.1 运行新增和受影响的 server read model 测试。
- [x] 6.2 运行新增和受影响的 workflow child-session spec。（已运行 route resolution + endpoint 级测试，共 30 个 pass）
- [x] 6.3 运行 active changes API 相关测试。
- [x] 6.4 运行仓库当前 canonical 测试入口中与 workflow、Pi、oz list 相关的测试。
- [x] 6.5 运行 `oz validate 35-修复Pi工作流子会话和oz列表加载 --json`。

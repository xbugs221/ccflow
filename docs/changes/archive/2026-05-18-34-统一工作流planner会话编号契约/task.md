# 任务

## 1. 审计现有契约

- [x] 1.1 对照当前 `wo` 源码确认规划会话保存 key 为 `<tool>:planner`。
- [x] 1.2 标出 cbw read model 中只读取 `planning` / `codex:planning` 的位置。
- [x] 1.3 标出 cbw 从 sessions/stages fallback 合成 `runnerProcesses` 的位置。
- [x] 1.4 标出前端把 runner process 行渲染为 `thread=<sessionId>` 的位置。

## 2. 修正 planner 会话读取

- [x] 2.1 在 `wo-read-model.ts` 增加 planner session 解析函数。
- [x] 2.2 按 `<planning-tool>:planner`、`codex:planner`、`planner` 优先读取规划会话。
- [x] 2.3 保留 `tool:planning`、`codex:planning`、`planning` legacy 兼容。
- [x] 2.4 确认规划 child session 的 route、stageKey、provider 和 sessionId 正确。

## 3. 收紧 runnerProcesses 语义

- [x] 3.1 将 `runnerProcesses` 改为只来自真实 `state.processes`。
- [x] 3.2 将 sessions-only 状态用于 childSessions 和角色摘要，不再伪造 process rows。
- [x] 3.3 保留 explicit process 的 `pid`、`session_id/sessionId`、`exit_code/exitCode`、`log_path/logPath`。
- [x] 3.4 前端进程区只在存在真实 `runnerProcesses` 时展示。
- [x] 3.5 前端进程行把 pid 和 thread/session 分开命名，不互相代替。

## 4. 更新测试 fixture 和旧预期

- [x] 4.1 将 Playwright fixture 中规划会话主路径从 `codex:planning` 改为 `codex:planner`。
- [x] 4.2 将 server read model 测试中的规划会话主路径改为 `codex:planner`。
- [x] 4.3 调整依赖 sessions-only fallback process rows 的测试，改为断言无进程区。
- [x] 4.4 保留一个 legacy `codex:planning` 兼容测试。

## 5. 编写真实测试

- [x] 5.1 在 `docs/changes/34-统一工作流planner会话编号契约/tests/` 编写 server 测试，覆盖 `codex:planner` 规划会话可链接。
- [x] 5.2 编写 server 测试，覆盖 sessions-only 状态不产生 `runnerProcesses`。
- [x] 5.3 编写 server 测试，覆盖 explicit `processes[].pid/session_id` 被分开保留。
- [x] 5.4 编写前端 spec，覆盖规划行可进入会话且没有 explicit processes 时不显示进程区。
- [x] 5.5 执行阶段将测试按来源命名迁移到根 `tests/`。

## 6. 验证

- [x] 6.1 运行新增和受影响的 server read model 测试。
- [x] 6.2 运行受影响的 Playwright/spec 测试。
- [x] 6.3 运行仓库当前 canonical 测试入口中与 workflow 相关的测试。
- [x] 6.4 运行 `oz validate 34-统一工作流planner会话编号契约 --json`。

# 统一工作流 planner 会话编号契约

## 问题

前端工作流详情页会把 `wo` runner 状态中的会话编号展示为可进入的 workflow child session。用户在前端能看到规划阶段的所谓 sessionID，但在 Codex CLI 里无法用同一个编号 resume，或者看到的编号并不是自己理解的进程编号。

根因不是单个页面样式问题，而是 cbw 对 `wo state.json` 的读取模型把三类概念混在了一起：

```text
wo state.json
  sessions["codex:planner"]  -> 规划会话 id
  sessions["codex:executor"] -> 写/修角色会话 id
  processes[].pid            -> 真实运行进程号（当前 wo JSON contract 未稳定提供）

cbw read model
  规划行只查 planning / codex:planning
  sessions-only fallback 会生成 runnerProcesses
  前端把 process 行里的 thread=<sessionId> 展示成进程相关信息
```

当前 `wo` 源码把规划会话保存为 `codex:planner`，而 cbw 只读取 `sessions.planning` 或 `sessions["codex:planning"]`。因此真实规划会话 id 即使存在，cbw 也可能读不到。另一方面，cbw 在没有真实 `processes` 字段时仍会从 `sessions` 和 stage 状态合成 `runnerProcesses`，导致前端出现没有 pid 的“进程”行，或者把 role session id 当成 thread/process 信息展示。

## 目标

- 让 cbw read model 按 `wo` 的真实角色契约读取规划会话：优先 `tool:planner`，兼容旧的 `tool:planning` / `planner` / `planning`。
- 区分 role session id 和 process pid：会话编号用于打开或 resume provider 会话，pid 只来自真实 process 数据。
- 取消从 `sessions` fallback 合成“进程”事实，避免前端展示无 pid 或错误含义的进程编号。
- 更新测试 fixture，使用当前 `wo` 契约里的 `codex:planner`，不再用 `codex:planning` 作为主路径。

## 范围

- 修改 `server/domains/workflows/wo-read-model.ts` 的 planning session 解析和 child session/read model 构造。
- 将 `runnerProcesses` 的含义收紧为真实 runner process 数据；sessions-only 状态仍可生成 child session 和角色摘要，但不得伪造 process rows。
- 修改 workflow 详情页对进程区的展示预期：只有真实 process 数据才显示进程区；session 行继续在角色摘要或 workflow line 中展示。
- 更新 Playwright fixture、server read model 测试和 spec 测试里的 planning session key。
- 保留 legacy `codex:planning` 兼容读取，便于旧运行态仍可显示。

## 非目标

- 不修改 `wo` CLI 或发布新 `wo` binary。
- 不在 cbw 里猜测或修复 Codex CLI 的本地 resume 索引。
- 不把 run id、stage key、log 文件名或 role session id 当成 pid。
- 不改变普通手动会话 `cN` 路由和 provider session 绑定逻辑。
- 不重做 workflow UI 样式。

## 测试策略

执行阶段需要在 `docs/changes/34-统一工作流planner会话编号契约/tests/` 写真实测试代码，再按来源迁移到根 `tests/`。测试应覆盖真实业务语义：

- server read model：`sessions["codex:planner"]` 能让规划行显示并链接规划会话。
- server read model：仅有 `sessions`、没有真实 `processes` 时，不产生 `runnerProcesses`。
- server read model：存在真实 `processes[].pid/sessionId` 时，进程行保留 pid 和 sessionId，二者不混淆。
- 前端 spec：workflow 详情页对 planner 会话显示“会话”，但没有真实 process 时不显示“进程”区。
- 回归兼容：旧 `sessions["codex:planning"]` 仍能被识别，但新测试主路径使用 `codex:planner`。

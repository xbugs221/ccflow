## Context

CCUI 的工作流自动推进依赖两层状态：`server/workflow-auto-runner.js` 中的内存防抖状态，以及 `server/workflows.js` 持久化到项目 `.ccflow/conf.json` 的 workflow 控制面状态。真正能让 UI、重启后的服务和后续阶段找到内部会话的是 `workflow.chat` / `childSessions` 索引；`completedKeys` / `inFlightKeys` 只能说明当前进程曾经处理过某个 action。

当前断口是：provider 会话已经创建，但 workflow 索引写回失败、被删或变成陈旧记录后，auto-runner 仍可能因为内存 key 认为 action 已完成，从而既找不到旧会话，也不再创建新会话。Claude Code 和 Codex CLI 的会话文件路径固定，可以用于有边界地扫描、补挂或隔离未登记的 provider 会话。

## Goals / Non-Goals

**Goals:**

- 让持久化 workflow 索引成为是否跳过自动触发的最终依据。
- 在索引缺失时，先尝试从 provider 固定会话目录找回同项目、同阶段的高置信 orphan 会话。
- 在重建内部会话前，隔离当前项目内未登记且可疑的 provider 会话，避免后续误绑定。
- 将 `index_missing`、`index_stale`、`orphan_recovered`、`orphan_quarantined`、`session_rebuilt` 等恢复状态写回工作流控制面。
- 保证已明确登记到任何 workflow 的会话不会被隔离或删除。

**Non-Goals:**

- 不改变 Claude Code 或 Codex CLI 的原始会话格式。
- 不把 provider 会话目录作为 workflow 的主存储。
- 不做跨项目、跨用户的全局会话清理。
- 不自动删除高风险候选；默认采用隔离或跳过。

## Decisions

### 1. 持久化索引优先于内存去重

`completedKeys` 和 `inFlightKeys` 只作为防止重复启动的短期保护。每次准备 skip 前，都必须检查当前 workflow 是否仍有匹配 `stageKey` / `routeIndex` / `sessionId` 的 child session 索引。

替代方案：继续信任 `completedKeys`。拒绝原因：这会让运行进程中的内存状态覆盖 `.ccflow/conf.json`，重启前无法自愈。

### 2. 恢复流程使用三态决策

索引缺失时按以下状态处理：

- `recover`: 找到唯一高置信 provider orphan，补写 workflow 索引，不新建会话。
- `quarantine_then_rebuild`: 没有可补挂会话，但存在未登记可疑会话，先隔离再允许重建。
- `rebuild`: 没有候选或候选不可信，清理对应内存 key 并允许重新启动内部会话。

替代方案：索引缺失时直接重建。拒绝原因：会留下旧 provider 会话，后续可能被误识别为当前 workflow 会话。

### 3. provider orphan 扫描必须保守

候选会话必须同时满足：

- 会话归属当前项目路径。
- 会话未出现在任何 workflow 的 `chat` / `childSessions` / `sessionWorkflowMetadataById`。
- 会话时间不早于 workflow 创建或最近 stage action 时间。
- 会话内容或元数据命中 workflow id、stage key、workflow title、autoPrompt 标记之一。

Codex 扫描 `~/.codex/sessions/YYYY/MM/DD/*.jsonl`，从 JSONL 事件中解析 cwd / prompt / session id。Claude Code 扫描 `~/.claude/projects/<encoded-project-path>/*.jsonl` 和同名 tool-results 目录。

替代方案：按 mtime 和 cwd 匹配即可。拒绝原因：同项目中可能有手动会话，必须降低误伤概率。

### 4. 隔离优先，不直接删除

重建前的“清掉”实现为移动到项目内 `.ccflow/orphan-sessions/quarantine/<provider>/<sessionId>/`，并写入 manifest，记录原路径、判断原因、关联 workflow/stage 和时间。只有人工或后续维护命令可以真正删除。

替代方案：直接删除 provider 会话文件。拒绝原因：误删会话不可恢复，且用户明确要求避免误伤已登记会话。

### 5. 控制面必须记录恢复事件

`server/workflows.js` 应提供追加 workflow controller event / stage warning 的入口。UI 和 API 返回的 workflow read model 应能暴露最近异常和恢复动作，至少包含：

- `type`
- `stageKey`
- `provider`
- `sessionId`
- `message`
- `createdAt`

替代方案：只写 server log。拒绝原因：log 不会跟随 workflow 状态展示，用户无法知道为什么会重建或未重建。

## Risks / Trade-offs

- [误判 orphan] -> 使用多条件匹配，只自动补挂唯一高置信候选；多个候选时只隔离低风险未登记项并记录事件。
- [隔离影响 provider 历史] -> 默认移动到 `.ccflow/orphan-sessions/quarantine/`，保留 manifest 和原路径，支持人工恢复。
- [扫描开销] -> 仅在 workflow 索引缺失且需要重建前扫描当前项目相关 provider 路径；Codex JSONL 扫描限制时间窗口。
- [现有内存 key 无法从外部观察] -> 增加可测试的纯函数处理 action/index/dedupe 状态，runner 使用该函数。
- [UI 没有立即展示 warning] -> 首期至少在 API read model 中暴露，后续 UI 可渲染为阶段提示。

## Migration Plan

1. 增加 workflow controller event / stage warning 的持久化字段，读取旧 workflow 时默认空数组。
2. 增加 provider session scanner，先实现 Codex 和 Claude Code 的只读候选识别。
3. 增加 quarantine planner / executor，默认移动未登记候选并写 manifest。
4. 修改 auto-runner：skip action 前执行索引健康检查；索引缺失时调用恢复/隔离/重建流程。
5. 增加验收测试覆盖红灯场景。
6. 回滚策略：关闭恢复扫描时仍保留原有 auto-runner 行为；quarantine manifest 可用于人工恢复 provider 会话文件。

## Open Questions

- 是否需要为 quarantine 增加 UI 恢复按钮，还是先仅保留文件和 manifest。
- Codex JSONL 中用于识别 autoPrompt 的字段是否需要统一写入 workflow metadata，减少全文扫描。

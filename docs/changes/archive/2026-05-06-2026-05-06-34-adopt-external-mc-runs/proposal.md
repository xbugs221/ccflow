# Proposal: 发现并接管外部 mc 工作流 run

## 背景

用户从其他终端直接启动 `mc` 后，项目目录已经出现 `.ccflow/runs/<run-id>/state.json`，但 Web 前端的工作流列表仍为空。只读排查确认当前数据流是：

```text
前端工作流列表
  -> GET /api/projects/:projectName/workflows
    -> attachWorkflowMetadata()
      -> listProjectWorkflows(projectPath)
        -> readWorkflowStore(projectPath)
          -> 只读 .ccflow/conf.json.workflows
          -> 不扫描 .ccflow/runs/*
```

因此外部终端启动的 `mc` run 只存在于 runner sealed state 中，未进入 ccflow 的 workflow 控制面索引。当前 `.ccflow/conf.json.workflows` 为空时，前端收到的 workflow read model 也是空数组。

同时实际 runner state 使用了 snake_case 字段：

```json
{
  "run_id": "20260506T122338.296554707Z",
  "change_name": "2026-05-06-33-search-session-by-thread",
  "status": "running",
  "stage": "execution"
}
```

现有代码已有部分 snake_case 兼容，但现有 spec 主要描述 camelCase `runId/changeName`。这不是列表为空的主因，但属于本变更应顺手固化的 contract 兼容边界。

## 变更内容

- 后端必须能发现项目 `.ccflow/runs/*/state.json` 中未登记的 Go runner run。
- Web 工作流列表必须展示外部终端启动、已完成或正在运行的 `mc` run，而不是只展示由 Web UI 创建的 workflow。
- 对外部 run 建立稳定的 workflow 控制面身份：至少包含 workflow route id、run id、OpenSpec change、stage、status、artifact/log 链接。
- 对运行中外部 run 建立 watcher，使后续 `state.json` 或 log/artifact 变化能刷新前端。
- 支持 runner state 的 `runId/changeName` 和 `run_id/change_name` 两种字段，统一归一到 Web read model 的 `runId/openspecChangeName`。

## 非目标

- 不启动新的 sealed run。
- 不把 `.ccflow/runs/` 当成可手工编辑的配置目录。
- 不恢复旧 Node auto-runner。
- 不在前端通过文件名或 DOM 状态猜测 workflow；归属必须由后端 read model 给出。
- 不要求外部 run 被接管后自动补写历史缺失的 Codex session 内容；只展示 runner state 已提供的事实。

## 影响范围

- `server/workflows.js`：workflow store 读取、Go runner state overlay、外部 run 发现/接管、routeIndex 分配。
- `server/domains/workflows/go-runner-client.js`：runner state 字段归一化或读取辅助。
- `server/index.js`：Go runner watcher 初始化与外部 run 目录 watcher 注册。
- 前端工作流列表和详情页：理论上继续消费现有 `ProjectWorkflow` read model，除非需要新增“外部接管”标识。
- 测试：补充无 `.ccflow/conf.json.workflows` 但存在 `.ccflow/runs/*/state.json` 的真实业务用例。

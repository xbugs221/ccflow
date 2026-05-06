## 1. 后端 discovery

- [x] 1.1 增加只扫描 `.ccflow/runs/*/state.json` 的 Go runner run discovery，不递归读取日志或 artifact 内容。
- [x] 1.2 归一化 runner state 字段：`runId/run_id`、`changeName/change_name`、`status`、`stage`。
- [x] 1.3 在 `listProjectWorkflows()` 中合并 `.ccflow/conf.json.workflows` 和未登记外部 run，并为外部 run 分配稳定 workflow route id。
- [x] 1.4 把接管后的最小 workflow record 持久化到 `.ccflow/conf.json.workflows`，避免刷新后 route 漂移。
- [x] 1.5 对损坏或不可解析的 `state.json` 做隔离处理，不让一个坏 run 破坏整个项目列表。

## 2. Watcher 与 read model

- [x] 2.1 确保服务启动时先 discovery 外部 run，再为 Go-backed workflow 注册 run 目录 watcher。
- [x] 2.2 确保外部 run 使用现有 `applyGoRunnerReadModel()` 派生阶段、artifact、runnerProcesses 和 childSessions。
- [x] 2.3 暴露必要的诊断字段或 controller event，用于说明 workflow 是从外部 `mc` run 接管而来。

## 3. 验证

- [x] 3.1 后端单测：无 `workflows` 配置但有 `.ccflow/runs/<run-id>/state.json` 时，列表返回对应 workflow。
- [x] 3.2 后端单测：snake_case state 能正确映射到 Web read model。
- [x] 3.3 后端单测：重复调用 discovery 不重复创建 workflow，route id 稳定。
- [x] 3.4 后端单测：已有 workflow 绑定同一 run 时不重复接管。
- [x] 3.5 业务级测试：模拟外部终端启动的 running/done run，前端工作流列表和详情页均可见。

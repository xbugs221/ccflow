## 背景

当前仓库的 OpenSpec 工作流控制面主要由 Node/TS/JS 代码实现：`server/workflows.js` 负责 change 发现、artifact 探测、阶段状态和 read model，`server/workflow-auto-runner.js` 负责自动推进 execution/review/repair/archive。这个实现把 UI 状态、OpenSpec 规则、Codex/Claude 子会话、断点恢复和 review/repair 状态机混在一起，已经变成稳定性风险。

用户已将两个关键部分重写为 Go CLI：

- `../mc`：Codex + OpenSpec 的终端工作流 runner，使用 `.ccflow/runs/<run-id>/state.json` 做 sealed run 状态，按 execution、三轮 review/repair、archive 推进。
- `opsx`：Go 版 OpenSpec CLI，支持 `new change`、`list --json`、`status --json`、`instructions apply --json`、`validate --json`、`archive --yes`，并以 `docs/` 作为当前 OpenSpec 文档根。

本变更要让 ccflow 依赖这两个外部 Go CLI，使 Go CLI 成为工作流与 OpenSpec 规则的事实来源。ccflow 仓库不 vendoring Go 源码、不打包二进制；用户必须先手动下载安装 `opsx` 和 workflow runner，当前仓库的 TS/JS 工作流状态机降级为 Web 适配层，最终删除重复实现。

## 变更内容

- 定义外部二进制前置依赖：用户必须手动安装 `opsx` 和 Go workflow runner，ccflow 只负责检测、调用和报错提示。
- 将当前仓库的 OpenSpec 文档根从旧 `openspec/` 迁移到 `docs/`，让 `opsx` 直接读取 `docs/changes` 与 `docs/specs`。
- 将后端 OpenSpec 调用统一到 `opsx`，移除对旧 `openspec` 命令和手写 change/task 扫描逻辑的依赖。
- 将 Web 工作流自动推进委托给 Go runner；Node 后端只负责启动进程、读取 `.ccflow/runs/<run-id>/state.json`、归一化 read model、推送 WebSocket 事件。
- 约束 Go workflow runner 的 CLI contract，使用户安装的版本必须支持启动校验用的 `mc contract --json` 和 Web 后端需要的非交互 JSON 命令、固定调用 `opsx`、固定使用 `.ccflow/runs` state root 和稳定日志/状态路径。
- 删除旧 TS/JS auto-runner 的自动推进职责，新工作流和后续执行都走 Go runner；不为旧 Node workflow 提供兼容迁移。

## 能力范围

### 新增能力

- `go-openspec-cli-integration`：ccflow 使用用户已安装的 `opsx` 作为 OpenSpec CLI。
- `go-workflow-runner-integration`：ccflow 使用用户已安装的 Go workflow runner 作为自动工作流执行引擎。

### 修改能力

- `project-workflow-control-plane`：Web 控制面从 Go runner 状态派生阶段、artifact、运行中/失败/完成状态，不再自己实现自动推进状态机。

## 影响范围

- 外部依赖：服务启动时检测 PATH 中的 `opsx` 与 `mc`，提供版本诊断、安装说明和缺失时的启动失败错误。
- Node 后端：新增 `server/domains/openspec/opsx-client.js`、`server/domains/workflows/go-runner-client.js` 或等价适配层；收缩 `server/workflows.js` 和 `server/workflow-auto-runner.js`。
- 前端：工作流详情页继续使用现有 read model，但要展示 Go runner 的 run id、状态、日志和恢复/失败原因。
- 测试：使用 fake CLI 做 Node 适配层单测；真实业务 e2e 依赖测试环境预装 `opsx` 和 Go workflow runner。
- 迁移：不兼容旧 Node workflow 自动推进状态；升级后需要用户基于 active OpenSpec change 重新启动 Go runner。

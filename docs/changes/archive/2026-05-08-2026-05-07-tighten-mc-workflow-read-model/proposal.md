## 背景

ccflow 已经把自动工作流执行收敛到 Go `mc` runner：Web 创建、恢复、中止工作流时调用 `mc run/resume/abort --json`，并从 `.ccflow/runs/<run-id>/state.json` 读取运行状态。前端保留工作流列表、详情页、阶段树、进程列表、日志和子会话跳转，这是合理的 Web adapter 职责。

当前仍存在一个边界不够干净的问题：仓库里同时保留了部分旧 Node/TS workflow 控制面语义、旧自动 prompt/launcher、`.ccflow/conf.json.workflows` 写入链路、`workflowAutoStart` 会话草稿链路、`routeIndex/wN` 排序或测试假设，以及过宽的 `ProjectWorkflow` 字段。这些代码未必都在实际推进工作流，但会让维护者无法判断哪些是 Web 展示所需、哪些是旧 runner 残留。

本变更的目标是彻底定义并落实边界：

- `mc` 是唯一工作流执行器和运行事实来源。
- ccflow 后端只做 `mc` command adapter、state file discovery、read model normalization、HTTP/WebSocket control plane。
- ccflow 前端只消费后端 `ProjectWorkflow` read model，不解析 `mc` 原始终端输出，不维护第二套 workflow 状态。
- 手动会话仍由 ccflow 管理；workflow-owned runner sessions 只作为 `mc` run 的展示和跳转入口。

## 变更内容

- 新增一个纯 read-model adapter 边界，把 `.ccflow/runs/<run-id>/state.json` 归一化为 `ProjectWorkflow`，并写清输入输出 contract。
- 删除或停用旧 Node/TS 自动工作流残留，包括自动阶段 prompt/launcher、`workflowAutoStart` 自动提交链路、`.ccflow/conf.json.workflows` 写入链路、controller event 持久化镜像。
- 保留前端 UI 展示代码，但要求所有 workflow 展示字段都来自 `mc` state 或后端运行时派生，不从 ccflow workflow store 读取。
- 明确 artifact/log/session/process 映射规则，避免把所有 runner path 都粗暴展示为同一种 artifact。
- 明确路由规则：workflow 使用 `/runs/<runId>`，workflow child session 使用 runner-owned 地址，不再依赖 `wN` 或 workflow `routeIndex`。
- 增加 runner diagnostics read model，让用户能在网页上看到 state 文件、mtime、raw status、`mc` contract、错误摘要和路径/会话/进程摘要。
- 清理前端类型中的 legacy workflow 字段，保留手动会话所需的 `cN routeIndex`，但不得把 workflow `routeIndex` 重新引入为显示或排序依据。
- 更新测试，覆盖真实业务状态：running、review、repair、failed/aborted、completed、外部终端启动的 run、缺少 state、损坏 state、多个同 stage session。

## 非目标

- 不把 `mc` Go 源码 vendoring 到 ccflow。
- 不让前端直接解析 `mc` 终端输出或 `state.json` 原始结构。
- 不恢复旧 Node/TS auto runner。
- 不迁移没有 `runId` 的历史 Node workflow。
- 不把 workflow 收藏、隐藏、置顶、重命名等 UI 偏好夹带进本次变更；若后续需要，必须另行设计，且不能覆盖 `mc` runner facts。

## 影响范围

- 后端：
  - `server/domains/workflows/go-runner-client.js`
  - 新增或抽取 `server/domains/workflows/mc-read-model.js`
  - 收缩 `server/workflows.js` 为 discovery、HTTP read model 聚合和 OpenSpec 辅助
  - 清理 `server/projects.js` 中 workflow-owned draft/auto-start 的旧路径
- 前端：
  - `src/types/app.ts`
  - `src/utils/projectRoute.ts`
  - `src/utils/workflowAutoStart.ts` 或其替代/删除
  - workflow 列表、详情页、runner process、artifact/log 跳转、项目路由解析
- 测试：
  - 增加 server read-model adapter 单测
  - 更新 route/e2e 测试中仍期待 `/wN` 的断言
  - 增加前端业务测试验证网页可查看和跳转 runner sessions/logs/artifacts


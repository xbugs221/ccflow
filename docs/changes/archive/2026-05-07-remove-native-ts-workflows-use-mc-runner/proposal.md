## 背景

ccflow 现在同时存在两套工作流执行路径：

- 旧的 Node/TS 原生工作流推进器：主要在 `server/workflow-auto-runner.js` 与 `server/workflows.js` 内部维护阶段判断、prompt 拼装、子会话创建、review/repair 推进和归档推进。
- 新的 Go `mc` 工作流程序：以 `.ccflow/runs/<run-id>/state.json` 作为 sealed run 状态事实来源，通过 `mc run/resume/status/abort --json` 推进 OpenSpec 工作流。

最近几个变更已经把 Web UI 创建、Go runner read model、外部 `.ccflow/runs/*/state.json` 接管等能力逐步接到了 `mc` 上，但仓库里仍保留旧 TS 自动推进器。这会造成三个问题：

- 行为来源不唯一：用户无法判断某个阶段到底是 Node 状态机推进，还是 Go `mc` 推进。
- 回退路径不透明：`mc` 缺失、provider 配置或历史 workflow 数据异常时，旧 TS 逻辑可能继续参与，掩盖部署/依赖问题。
- 维护成本重复：review/repair/archive 状态机、prompt、OpenSpec artifact 规则在 Node 和 Go 两边重复，后续修复容易只改一边。

本变更的目标是彻底收敛执行路径：ccflow 只做 Web 控制面、read model、路由、会话展示和文件链接；所有自动工作流执行只委托给 Go `mc`。不保留旧 TS workflow 的历史兼容路径。

## 变更内容

- 删除 ccflow 原生 Node/TS 自动工作流推进器，不再由 `server/workflow-auto-runner.js` 创建 execution/review/repair/archive 子会话。
- Web UI 新建工作流时必须启动 `mc run --change <change> --json`；随后前端列表必须从 `.ccflow/runs/<run-id>/state.json` 看到该 workflow。
- workflow 恢复、状态刷新、中止必须分别走 `mc resume/status/abort --json` 或读取 `.ccflow/runs/<run-id>/state.json`，不得调用旧 TS 阶段推进逻辑。
- 服务启动和诊断必须明确校验 `mc contract --json`；缺失或能力不匹配时返回可见错误，不允许静默回退到旧 TS runner。
- 删除旧阶段 provider 对自动工作流执行路径的影响。自动工作流 provider 由 `mc` sealed state 决定，前端不再提供能切回 Node/Claude/TS 自动推进的入口。
- 历史上没有 `runId` 的旧 Node workflow 不再迁移、不展示、不自动推进；清理时可直接从工作流索引中删除。
- 删除旧 TS runner 专属测试、fixtures 和文档，保留能证明 Web 控制面正确消费 `mc` state 的测试。
- 移除 `.ccflow/conf.json.workflows` 作为 workflow 索引的职责。工作流列表必须完全从 `.ccflow/runs/*/state.json` 扫描派生；前端需要的 `ProjectWorkflow` read model 由后端运行时生成。
- 本变更不保留 workflow 收藏、隐藏、置顶、重命名等 ccflow 自有 workflow UI 状态；这些能力如仍需要，必须后续单独设计，不能夹在 runner 收敛里。

## 非目标

- 不把 `../mc` 的 Go 源码 vendoring 到 ccflow 仓库。
- 不实现第二套 Go runner；只适配用户 PATH 中的 `mc`。
- 不迁移旧 Node workflow 到新的 `mc` run。没有 `runId` 的历史 workflow 直接移除或忽略。
- 不恢复旧 `openspec` CLI 或手写 OpenSpec 状态机作为 fallback。

## 影响范围

- 后端：
  - 删除 `server/workflow-auto-runner.js` 或使其完全退出代码路径。
  - `server/index.js` 不再调度旧 auto-runner。
  - `server/workflows.js` 保留 workflow read-model 逻辑，但不再把 `.ccflow/conf.json.workflows` 当成工作流索引。
  - `server/domains/workflows/go-runner-client.js` 成为唯一 runner adapter。
  - 清理旧 TS runner 专属测试集，避免测试继续固化被删除行为。
- 前端：
  - 新建 workflow 的 provider/stage provider 控件要收敛到 `mc` runner 语义。
  - workflow 详情页继续展示 stage tree、runner processes、artifact、child sessions，但状态来源只允许是 `mc` state。
  - 旧 TS runner 文档入口和说明移除。
- 测试：
  - 补充缺失 `mc` 时无 TS fallback 的服务/接口测试。
  - 补充创建、恢复、中止 workflow 只调用 fake `mc` 的业务测试。
  - 补充没有 `.ccflow/conf.json.workflows` 时仍能从 `.ccflow/runs/*/state.json` 显示工作流的业务测试。

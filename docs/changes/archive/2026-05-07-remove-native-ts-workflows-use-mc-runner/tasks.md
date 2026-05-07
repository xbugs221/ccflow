## 1. Runner 边界

- [x] 1.1 梳理 `server/workflow-auto-runner.js`、`server/workflows.js`、`server/index.js` 中所有旧 Node/TS 自动推进入口。
- [x] 1.2 为创建、恢复、中止 workflow 增加 fake `mc` 测试，证明接口只调用 `mc run/resume/abort/status --json`。
- [x] 1.3 增加缺失或 contract 不匹配的 `mc` 测试，证明系统返回明确错误且不回退到旧 TS runner。
- [x] 1.4 增加 runs/state/read-model 测试，证明没有 `.ccflow/conf.json.workflows` 也能显示 mc 工作流。

## 2. 后端移除

- [x] 2.1 从服务启动和定时/事件调度中移除旧 auto-runner。
- [x] 2.2 删除 `server/workflow-auto-runner.js`。
- [x] 2.3 删除旧 Node 自动阶段 action 解析、prompt 拼装、provider 子会话创建、review/repair/archive 推进逻辑。
- [x] 2.4 删除 `.ccflow/conf.json.workflows` 作为 workflow 索引的读写逻辑。
- [x] 2.5 workflow 列表和详情完全从 `.ccflow/runs/*/state.json` 派生。
- [x] 2.6 删除 workflow 收藏、隐藏、置顶、重命名等依赖旧 workflow 记录的 UI 状态。
- [x] 2.7 旧 `.ccflow/conf.json.workflows` 分组直接忽略或清理，不参与前端 read model。

## 3. 前端收敛

- [x] 3.1 移除工作流创建表单中会影响旧 Node/TS 自动阶段 provider 的配置入口。
- [x] 3.2 工作流详情页展示 `mc` run id、状态、错误和诊断，不展示可切回旧 runner 的控件。
- [x] 3.3 前端只消费 Go `mc` read model，不保留 legacy workflow 专属 UI 分支。
- [x] 3.4 将 workflow 路由从 `wN/cM` 迁移为 runId-based route。

## 4. 清理过期资产

- [x] 4.1 删除旧 TS workflow runner 专属测试。
- [x] 4.2 删除旧 TS workflow runner 专属 fixtures/fake provider 数据。
- [x] 4.3 删除或更新仍描述 Node/TS workflow 自动推进的文档。
- [x] 4.4 删除前端旧 provider/stage provider 配置说明。

## 5. 验证

- [x] 5.1 `pnpm run test:server`
- [x] 5.2 `pnpm run test:spec`
- [x] 5.3 用真实浏览器打开 `http://localhost:4001/`，确认 `matx`、`mc`、`ox` 既有 `.ccflow/runs` 工作流仍显示。
- [x] 5.4 在 fake `mc` 环境创建一个新 workflow，确认不写 `.ccflow/conf.json.workflows`，前端直接从 `.ccflow/runs/<run-id>/state.json` 显示该 workflow。

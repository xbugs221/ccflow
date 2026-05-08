## 背景

ccflow 已经改为读取 `wo` 的 `.wo/runs/<run-id>/state.json` 并在 workflow 详情页展示 `wo` 风格进度行。但现有 read model 仍残留了两类不稳定逻辑：

- 后端把可识别阶段固定到三轮 review / repair，遇到 `review_4`、`repair_4` 等合法多轮状态时会报 `Unknown runner stage`，并把它们排到 `archive` / `done` 之后。
- 当 `state.json` 缺少 `workflow_display.lines` 时，后端会自行生成主进度行；这条 fallback 必须严格遵循 `wo` 程序输出语义，不能按前端偏好改写阶段文案。

同时，项目列表会把 Codex 配置中存在的 `/tmp/Test.../001` 测试残留项目当作普通项目展示。由于左侧导航只显示 basename，多个不同临时路径都会显示为 `001`，用户无法区分，也会误以为真实项目被重复创建。

## 变更内容

- 修正 `wo` workflow read model 的阶段识别和排序，支持任意已发生的 `review_N` / `repair_N`。
- 主进度展示以 `wo` 程序输出样式为准：
  - 优先使用 `state.workflow_display.lines`。
  - 缺少该字段时，fallback 只按 `wo` 既定文本生成 `start`、`review`、`N fix`、`N fix review`、`archive`。
  - `N fix review` 表示第 N 轮循环中先修复再审核后的 review，不得改写为 `review N`、`复审 N` 或其他前端自造文案。
- `done` / `status=done` 作为终态元数据处理，不得被当成未知普通阶段插入主进度行。
- 合法多轮 `review_N` / `repair_N` 不再产生 diagnostics warning。
- 修正项目列表对 Codex 测试临时项目和同名项目的处理，避免左侧出现多个不可区分的 `001`。

## 能力范围

- 支持 `max_review_iterations` 大于 3 的实际 run。
- 支持已完成 run 中出现多轮 `repair_N` 和 `review_N` 后仍按 `wo` 语义顺序展示。
- 支持过滤明显的 Codex 测试临时项目残留，或对无法过滤的同名项目显示可区分信息。
- 支持通过 server 测试和浏览器规格测试回归验证项目导航与 workflow 详情展示。

## 非目标

- 不修改 `wo` runner 的输出格式或状态文件契约。
- 不重新设计 workflow 详情页样式。
- 不恢复旧的 `.ccflow/runs` 或旧 `mc` / `ox` 兼容。
- 不在本提案创建或启动新的 `.wo/runs` sealed run。

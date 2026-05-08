## 1. wo read model 修复

- [x] 1.1 梳理 `wo-read-model` 中阶段识别、排序、文案生成和 diagnostics warning 的当前逻辑。
- [x] 1.2 将固定三轮 `KNOWN_STAGES` 改为动态阶段排序，支持任意已发生的 `review_N` / `repair_N`。
- [x] 1.3 保持 `workflow_display.lines` 为主进度权威来源，只补充 session reference。
- [x] 1.4 修正缺少 `workflow_display.lines` 时的 fallback，确保文本严格匹配 `wo` 输出语义：`start`、`review`、`N fix`、`N fix review`、`archive`。
- [x] 1.5 将 `stage=done` / `status=done` 作为终态元数据处理，不自造主进度 `done` 行。
- [x] 1.6 移除合法多轮阶段的 unknown warning，仅对真正未知阶段保留 diagnostics。

## 2. 项目列表修复

- [x] 2.1 梳理 `/api/projects` 中 Claude、手工配置、Codex-only、active provider session 的项目合并逻辑。
- [x] 2.2 为 Codex 测试临时目录残留增加保守过滤：仅过滤明显测试路径且无会话、无 workflow、非用户显式保留的项目。
- [x] 2.3 为无法过滤的同名项目提供可区分展示名或短路径。
- [x] 2.4 确保项目选择、路由和会话加载仍以 fullPath / routePath 区分项目，不依赖 displayName。

## 3. 测试代码

- [x] 3.1 在 `docs/changes/2-修正项目列表和wo进度展示/tests/` 编写真正测试代码，并在执行阶段同步到仓库根测试套件。
- [x] 3.2 server read model 测试：构造六轮 review / 五轮 repair 的 `.wo/runs/<run-id>/state.json`，断言 `workflowDisplay.lines` 顺序和 diagnostics。
- [x] 3.3 server read model 测试：覆盖 `workflow_display.lines` 优先级，断言 `1 fix review` 不被改写。
- [x] 3.4 server read model 测试：覆盖 `stage=done` / `status=done` 不生成主进度 `done` 行。
- [x] 3.5 project discovery 测试：覆盖多个 `/tmp/Test.../001` 无业务数据项目不会进入 `/api/projects`。
- [x] 3.6 browser spec 测试：覆盖左侧项目导航不显示多个不可区分的 `001`，workflow 详情页保持 `wo` 风格进度文本。

## 4. 验证

- [x] 4.1 运行 `oz validate 2-修正项目列表和wo进度展示 --json`。
- [x] 4.2 运行相关 server 测试。
- [x] 4.3 运行相关 browser/spec 测试。
- [x] 4.4 在 `localhost:4001` 手动检查 `ccflow`、`matx`、`wo` 等项目的左侧导航和 workflow 详情页。

## 新增需求

### 需求：使用 wo 和 oz 作为唯一工作流命令

系统必须通过 `wo` 和 `oz` 管理自动工作流，不得继续调用旧 `mc` 或 `ox`。

#### 场景：列出可启动的 oz change

- **当** `oz list --json` 返回 `changes[0].name = "1-适配wo-oz并展示新版工作流输出"`
- **则** ccflow 的可采用 change 列表必须包含 `1-适配wo-oz并展示新版工作流输出`
- **且** 后端不得调用 `ox list --json`
- **且** 后端不得自行扫描 `docs/changes` 作为 fallback

#### 场景：启动 wo sealed run

- **当** 用户在 ccflow 中选择 active change 并启动自动 workflow
- **则** 后端必须运行 `wo run --change <change> --json`
- **且** 必须从返回 JSON 的 `run_id` 读取 run id
- **且** 必须等待 `.wo/runs/<run-id>/state.json`
- **且** 不得等待或读取 `.ccflow/runs/<run-id>/state.json`

#### 场景：继续和终止 wo sealed run

- **当** 用户点击继续 workflow
- **则** 后端必须运行 `wo resume --run-id <run-id> --json`
- **当** 用户点击终止 workflow
- **则** 后端必须运行 `wo abort --run-id <run-id> --json`
- **且** 两个流程都不得调用旧 `mc`

### 需求：不保留旧运行态兼容

系统必须只读取新版 `.wo/runs` 状态。

#### 场景：仓库只存在旧 ccflow 运行态

- **当** 项目中存在 `.ccflow/runs/old-run/state.json`
- **且** 不存在 `.wo/runs`
- **则** workflow 列表不得显示 `old-run`
- **且** 诊断文案不得提示旧 run 可继续

#### 场景：runner JSON 只使用 snake_case

- **当** `wo run --json` 返回 `{"run_id":"run-a","change_name":"change-a"}`
- **则** ccflow 必须正常绑定 run `run-a`
- **且** 新测试不得要求 `runId` 或 `changeName` 兼容

### 需求：前端直接组件化展示 wo 输出内容

系统必须把 `wo` 的可见输出内容作为 workflow 主展示，不得再展示旧的阶段产物树形流水线。

#### 场景：只展示已发生阶段

- **当** `.wo/runs/run-a/state.json` 表示 execution 已完成且 `review_1` 正在运行
- **则** workflow 详情页必须显示 `✓ start` 和 `→ review`
- **且** 不得显示 `1 fix`
- **且** 不得显示 `1 fix review`
- **且** 不得显示未来 archive 行

#### 场景：review 通过后直接归档

- **当** `.wo/runs/run-a/state.json` 表示 `review_1` 已完成且当前阶段为 `archive`
- **且** 没有任何 repair 阶段记录
- **则** workflow 详情页必须显示 `✓ review` 和 `→ archive`
- **且** 不得显示 `1 fix`

#### 场景：fix 和下一轮 review 采用 wo 输出文本

- **当** `.wo/runs/run-a/state.json` 表示 `repair_1` 已完成且 `review_2` 正在运行
- **则** workflow 详情页必须显示 `✓ 1 fix` 和 `→ 1 fix review`
- **且** 这些文本必须直接作为展示内容
- **且** 前端不得把它们改写成 `初修`、`再审` 或其他旧阶段名称

#### 场景：旧树形流水线被移除

- **当** 用户打开 workflow 详情页
- **则** 页面不得渲染旧的阶段产物树容器
- **且** 页面不得在主流程中展示 stage artifact 节点
- **且** 页面不得展示旧 pipeline 连接线

### 需求：会话 jsonl 名称可点击跳转

系统必须把 `wo` 输出行中的会话 jsonl 名称渲染为会话链接。

#### 场景：start 行包含执行会话 jsonl

- **当** workflow display line 为 `✓ start codex-exec-thread.jsonl`
- **且** 后端 read model 中存在对应 child session
- **则** 前端必须把 `codex-exec-thread.jsonl` 渲染成可点击链接
- **当** 用户点击该链接
- **则** ccflow 必须导航到该 workflow child session

#### 场景：review 行包含审核会话 jsonl

- **当** workflow display line 为 `→ review codex-review-thread.jsonl`
- **且** 对应 session provider 为 `codex`
- **则** 点击链接后必须打开 Codex session 历史
- **且** 路由必须保留 workflow id 和 stage 上下文

#### 场景：无法匹配会话时保留文本

- **当** workflow display line 包含 `unknown-thread.jsonl`
- **且** read model 中没有对应 child session
- **则** 前端必须显示普通文本 `unknown-thread.jsonl`
- **且** diagnostics 必须包含无法匹配会话的 warning

### 需求：测试覆盖真实端到端工作流

系统必须用真实业务流测试新版命令契约、read model 和浏览器展示。

#### 场景：端到端展示 wo 输出并跳转会话

- **当** 测试环境提供 fake `oz` 和 fake `wo`
- **且** fake `wo run --json` 写入 `.wo/runs/run-a/state.json`
- **且** ccflow 后端读取该项目
- **当** 浏览器打开 workflow 详情页
- **则** 页面必须显示 `wo` 风格输出行
- **且** 不得显示旧树形流水线
- **当** 用户点击 `codex-exec-thread.jsonl`
- **则** 页面必须进入对应 workflow child session

#### 场景：旧 mc/ox 调用回归防护

- **当** 测试 PATH 中只提供 `wo` 和 `oz`
- **且** 不提供 `mc` 和 `ox`
- **则** server workflow 测试和端到端测试必须通过

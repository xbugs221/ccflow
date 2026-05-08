## 1. 后端命令迁移

- [x] 1.1 将 OpenSpec/oz 客户端改为调用 `oz list/status/validate/archive`，删除 `ox` 命名和 `instructions apply` 入口。
- [x] 1.2 将 Go runner 客户端改为调用 `wo contract/list-changes/run/resume/status/abort --json`。
- [x] 1.3 将运行态根目录从 `.ccflow/runs` 改为 `.wo/runs`。
- [x] 1.4 删除旧 `mc`、旧 `ox`、旧 `.ccflow/runs` 和旧 camelCase runner 字段兼容路径。
- [x] 1.5 更新 README 和错误提示，说明 ccflow 当前依赖 `wo` / `oz`。

## 2. wo 输出 read model

- [x] 2.1 将旧 `mc-read-model` 重命名或重写为 `wo-read-model`。
- [x] 2.2 从 `.wo/runs/<run-id>/state.json` 生成 `workflowDisplay.lines`。
- [x] 2.3 `workflowDisplay.lines[].text` 直接采用 `wo` 输出语义，不映射为旧阶段标题。
- [x] 2.4 只生成已发生阶段行，不生成未来 review / repair / archive 占位。
- [x] 2.5 解析输出行中的会话 jsonl 名称，匹配 child session 并生成可点击 session reference。
- [x] 2.6 无法匹配 jsonl 会话时保留文本并写入 diagnostics warning。

## 3. 前端展示迁移

- [x] 3.1 移除 `WorkflowDetailView` 中旧的阶段产物树形流水线主展示。
- [x] 3.2 新增或改造 workflow display 组件，以行组件展示 `✓`、`→`、文本和会话链接。
- [x] 3.3 点击会话 jsonl 链接时复用现有 workflow child session 路由上下文。
- [x] 3.4 将 runner diagnostics 文案从 `mc contract` 改为 `wo contract`。
- [x] 3.5 保留必要的日志/诊断辅助区，但不把 artifacts 放入主阶段流水线。

## 4. 测试代码

- [x] 4.1 在 `docs/changes/1-适配wo-oz并展示新版工作流输出/tests/` 编写真实测试代码，并在执行阶段同步到仓库根测试套件。
- [x] 4.2 server 测试：fake PATH 只提供 `wo` 和 `oz`，验证后端不会调用 `mc` 或 `ox`。
- [x] 4.3 server 测试：fake `wo run --json` 写入 `.wo/runs/run-a/state.json`，验证 workflow 绑定 `run_id` 并读取 `.wo/runs`。
- [x] 4.4 read model 测试：覆盖 `start -> review`、`review -> archive`、`repair_1 -> review_2` 三种已发生阶段展示。
- [x] 4.5 read model 测试：覆盖 jsonl 会话名称匹配成功和匹配失败 warning。
- [x] 4.6 浏览器 spec 测试：打开 workflow 详情页，断言显示 `✓ start`、`→ review`，且不出现旧树形流水线 test id。
- [x] 4.7 端到端测试：fake `oz` active change + fake `wo` sealed state + 浏览器点击 `codex-exec-thread.jsonl` 进入 workflow child session。
- [x] 4.8 回归测试：PATH 中没有 `mc` 和 `ox` 时，server workflow 测试和端到端测试仍通过。

## 5. 验证

- [x] 5.1 运行 `oz validate 1-适配wo-oz并展示新版工作流输出 --json`。
- [x] 5.2 运行相关 server 测试。
- [x] 5.3 运行相关 spec/browser 测试。
- [x] 5.4 运行新增端到端测试。

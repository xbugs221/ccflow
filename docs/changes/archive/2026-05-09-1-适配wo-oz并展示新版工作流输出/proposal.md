## 背景

ccflow 目前仍按旧的 `mc` / `ox` 命令和 `.ccflow/runs/<run-id>/state.json` 读取自动工作流。底层工具已经改名并调整契约：活动提案由 `oz` 管理，工作流驱动器由 `wo` 管理，运行态目录统一为 `.wo/runs/<run-id>/`，runner JSON 也只保留 snake_case 字段。

同时，`wo` 的人类可读进度输出已经重新设计：它只显示已经发生的阶段，使用 `✓` 和 `→` 表达完成与当前运行状态，并直接输出 `start`、`review`、`1 fix`、`1 fix review`、`archive` 等用户可见文本。ccflow 现在的前端仍把内部阶段和各阶段产物渲染成树形流水线，会展示未来阶段和产物占位，已经偏离 `wo` 的当前使用体验。

## 变更内容

- 将后端命令依赖从 `mc` / `ox` 切换为 `wo` / `oz`。
- 不考虑历史兼容性：不读取旧 `.ccflow/runs`，不保留旧 `mc` / `ox` fallback，不支持旧 camelCase runner 字段作为主要契约。
- 后端从 `.wo/runs/<run-id>/state.json` 构建 workflow read model，并暴露 `wo` 输出行级结构给前端。
- 前端移除原先包含各阶段产物的树形流水线，改为组件化展示 `wo` 的输出内容。
- `wo` 输出行中的会话 jsonl 名称不再作为普通文本展示，而是解析为可点击的会话链接，跳转到对应 Codex / OpenCode 会话。
- 保留 runner 诊断、日志和错误信息展示，但它们不再混入主阶段流水线。
- 更新 README 和相关提示文案，统一使用 `wo` / `oz`、`.wo/runs` 和新版输出语义。

## 能力范围

- 支持通过 `oz list --json` 发现 active changes。
- 支持通过 `wo run/resume/status/abort --json` 管理 sealed workflow。
- 支持只展示 `wo` 已输出的阶段行，不在前端预告未来 review / fix / archive。
- 支持把阶段行里的会话 jsonl 名称转为跳转链接。
- 支持端到端验证：从 fake `oz` active change 到 fake `wo` sealed state，再到浏览器中展示新版 workflow 输出组件。

## 影响范围

- `server/domains/openspec/ox-client.js`
- `server/domains/workflows/go-runner-client.js`
- `server/domains/workflows/mc-read-model.js`
- `server/workflows.js`
- `src/components/main-content/view/subcomponents/WorkflowDetailView.tsx`
- `src/components/workflow/WorkflowStageProgress.tsx`
- `src/types/app.ts`
- README、server 测试、spec/browser 测试、e2e 测试

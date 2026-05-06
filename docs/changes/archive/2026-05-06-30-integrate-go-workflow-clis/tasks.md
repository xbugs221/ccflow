## 1. OpenSpec CLI 外部依赖

- [x] 1.1 服务启动时检测 PATH 中的 `opsx`，缺失或不可执行则直接启动失败。
- [x] 1.2 增加 `opsx --version` 诊断，缺失或版本不兼容时返回明确错误。
- [x] 1.3 更新 README，要求用户先手动下载安装 `opsx` 并确保服务进程 PATH 可见；不提供环境变量覆盖方式。
- [x] 1.4 将当前仓库 OpenSpec artifacts 从 `openspec/` 迁移到 `docs/`，并确认 `opsx list/status/validate` 直接读取 `docs/`。
- [x] 1.5 用 `opsx` 替换 Node 后端中旧 `openspec` 命令调用和手写 active change 发现逻辑。

## 2. Go workflow runner 外部依赖

- [x] 2.1 服务启动时检测 PATH 中的 `mc`，缺失或不可执行则直接启动失败。
- [x] 2.2 增加 runner version/contract 诊断，确认已支持 `docs/changes`、`opsx` 驱动和 Web JSON 命令。
- [x] 2.3 在 README 中列出 runner 必须支持的非交互 JSON 命令：contract/list/run/resume/status/abort。
- [x] 2.4 缺少 `mc` 或 contract 不兼容时，服务启动失败并返回可操作错误，不启动旧 TS 状态机。
- [x] 2.5 保证 `.ccflow/runs/<run-id>/state.json`、logs、review/repair/archive artifacts 的路径稳定且跨平台。

## 3. Node 后端替换

- [x] 3.1 新增 `opsx` client，所有 OpenSpec list/status/instructions/validate/archive 都通过 JSON contract 调用。
- [x] 3.2 新增 Go runner client，负责启动、恢复、查询和中止 run，不解析 Codex JSONL 细节。
- [x] 3.3 重构 workflow 创建流程：新 workflow 写入 `runner: "go"`、`runId`、`openspecChangeName`。
- [x] 3.4 重构 workflow read model：从 Go `state.json` 和 artifact 文件派生阶段状态、产物链接和错误信息。
- [x] 3.5 禁用 Go-backed workflow 的非 Codex 阶段 provider 自动推进入口，避免保留旧 TS 状态机。
- [x] 3.6 删除或停用旧 Node auto-runner，确保不会继续自动推进旧 workflow。

## 4. UI 与迁移

- [x] 4.1 工作流详情页展示 Go runner run id、当前 stage、运行/失败/完成状态和日志入口。
- [x] 4.2 移除旧 Node workflow 的兼容 UI；升级说明中要求用户基于 active change 重新启动 Go runner。
- [x] 4.3 更新设置或诊断页，展示启动时解析到的 `opsx` 与 `mc` 路径和版本，不提供路径覆盖控件。
- [x] 4.4 更新 README，说明 Go 工具手动安装、OpenSpec 文档根 `docs/`、运行时 `.ccflow/runs` 目录和不兼容旧 workflow 自动推进状态。

## 5. 验收

- [x] 5.1 Node 单测：使用 fake `opsx`/fake runner 验证后端只依赖 JSON contract 和 `state.json`。
- [x] 5.2 启动与诊断测试：覆盖 `opsx` 缺失、`mc` 缺失、版本不兼容、PATH 可见时成功启动。
- [x] 5.3 Spec 测试：覆盖新建 workflow、Go run 状态映射、resume、失败展示、旧 Node auto-runner 不再启动。
- [x] 5.4 E2E：启动一个真实 OpenSpec change，确认 Web UI 能看到 Go runner 阶段推进和 artifacts。
- [x] 5.5 回归：`pnpm typecheck`、`pnpm test:server`、相关 `tests/spec` 全部通过。

## 1. Provider 收敛

- [x] 1.1 梳理 Claude 相关入口：后端 SDK、路由、WebSocket 分支、项目发现、前端 provider、设置、i18n、测试和文档。
- [x] 1.2 删除 Claude SDK 适配和 `claude-command` 执行路径。
- [x] 1.3 将 provider 类型收敛为 `codex | opencode`，移除所有 `claude` 默认回退。
- [x] 1.4 修正手动会话创建接口，明确接受 `codex` 和 `opencode`，拒绝不支持的 provider。
- [x] 1.5 删除前端 Claude provider 入口、模型选择、thinking mode、权限设置和相关文案。

## 2. Runner 边界

- [x] 2.1 定义最小 StartTurn 输入，只包含 provider、projectPath、prompt、session id、clientRequestId 和 provider 必需选项。
- [x] 2.2 新增独立 `ccflow-runner` 进程入口，支持 Codex 和 OpenCode 两个 adapter。
- [x] 2.3 将 Codex CLI spawn 和事件转换迁移到 runner。
- [x] 2.4 将 OpenCode CLI spawn 和事件转换迁移到 runner。
- [x] 2.5 Web 服务改为提交 StartTurn 并 tail runner 事件，不再直接持有 CLI stdout/stderr。

## 3. 最小运行态

- [x] 3.1 为每个 turn 创建 `.ccflow/runtime/turns/<turnId>/turn.json` 和 `events.jsonl`。
- [x] 3.2 限制 `turn.json` 字段，不写 summary、label、favorite、hidden、routeIndex、完整 prompt、attachments 内容和 token 聚合缓存。
- [x] 3.3 `events.jsonl` 沿用现有前端事件类型，避免新增复杂协议。
- [x] 3.4 session-created 到达后继续 finalize `cN` 草稿会话到真实 provider session id。

## 4. 重启恢复和 abort

- [x] 4.1 Web 服务启动时扫描 running turn，并校验 pid 是否存活。
- [x] 4.2 对 pid 存活的 turn 恢复 tail `events.jsonl` 和 active session 状态。
- [x] 4.3 对 pid 不存在的 running turn 标记 failed 或 stale。
- [x] 4.4 将 abort 改为请求 runner 终止对应 CLI 进程，并写入结束事件。
- [x] 4.5 补充 systemd/部署说明，确保 runner 与 Web 服务生命周期分离。

## 5. 测试代码

- [x] 5.1 在 `docs/changes/2026-05-09-3-拆分runner并移除Claude/tests/` 编写真正测试代码，并在执行阶段同步到仓库根测试套件。
- [x] 5.2 server 测试：手动会话 provider 只接受 `codex | opencode`，不再回退 Claude。
- [x] 5.3 server 测试：fake runner turn 只生成 `turn.json` 和 `events.jsonl`。
- [x] 5.4 server 测试：`turn.json` 不包含非必要 UI 字段。
- [x] 5.5 server 测试：Web 服务启动后恢复 pid 存活的 running turn。
- [x] 5.6 server 测试：pid 不存在的 running turn 被标记 failed 或 stale。
- [x] 5.7 browser 测试：Codex/OpenCode 会话在 WebSocket 重连后继续展示 runner 后续事件。
- [x] 5.8 回归测试：项目、聊天、设置界面不再出现 Claude 入口。

## 6. 验证

- [x] 6.1 运行 `oz validate 2026-05-09-3-拆分runner并移除Claude --json`。
- [x] 6.2 运行相关 server 测试。
- [x] 6.3 运行相关 browser/spec 测试。
- [x] 6.4 手动验证 Web 服务重启时 Codex/OpenCode fake long-running turn 不被打断。

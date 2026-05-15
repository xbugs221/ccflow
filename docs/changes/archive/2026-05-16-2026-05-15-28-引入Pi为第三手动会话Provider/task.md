## 1. 契约和文档

- [x] 1.1 将手动 provider 契约扩展为 `codex | opencode | pi`。
- [x] 1.2 更新 `docs/specs/manual-provider-runner.md`，说明 Pi 经 co 文件协议执行。
- [x] 1.3 更新 `docs/specs/workflow-wo-oz.md`，说明 `pi:*` 在匹配 Pi 会话时可跳转。
- [x] 1.4 保留未知 provider 拒绝契约，确认 Claude 不会重新变成可用 provider。

## 2. 后端 provider 和 co 协议

- [x] 2.1 扩展 `normalizeManualProvider`、`buildCoRequest`、`normalizeCoProviders`、`isCoProviderAvailable` 和错误文案，支持 `pi`。
- [x] 2.2 扩展 `CO_EVENT_TYPES`，支持 `pi-response`、`pi-complete`、`pi-error`。
- [x] 2.3 扩展手动会话创建和 finalize 流程，支持 `provider = "pi"`。
- [x] 2.4 扩展 WebSocket pi-command 发送、abort、check-session-status、active-sessions 和 conversation observer，支持 Pi。
- [x] 2.5 确认 Pi 发送和终止都只写 co request，不直接 spawn `pi`。

## 3. 项目 read model 和工作流链接

- [x] 3.1 增加 `piSessions` 项目 read model 字段。
- [x] 3.2 扩展会话收集、排序、rename、delete、favorite、pending、hidden 等逻辑，包含 `piSessions`。
- [x] 3.3 扩展 session provider 推断，确保路由、REST history 和 WebSocket 过滤能识别 Pi。
- [x] 3.4 将 workflow read model 的 known provider 扩展到 Pi。
- [x] 3.5 覆盖 `pi:*` 有匹配会话时可跳转、无匹配时保持 unlinked。

## 4. 前端交互

- [x] 4.1 在项目概览新建会话 provider picker 中加入 Pi。
- [x] 4.2 在聊天空状态 provider picker 中加入 Pi。
- [x] 4.3 确保 Codex 专属模型和 reasoning 控件不会在 Pi 下显示。
- [x] 4.4 增加或复用 Pi provider logo/fallback，不引入不必要资源。
- [x] 4.5 更新 i18n 文案，包含 Pi 名称、ready prompt 和错误提示。

## 5. Pi 状态和诊断

- [x] 5.1 新增 Pi CLI 基础状态探测，检查服务进程可见的 `pi`。
- [x] 5.2 设置页展示 Pi CLI 可用、不可用和未知认证状态。
- [x] 5.3 确保 Pi 状态接口不返回 API key、token 或 secret。
- [x] 5.4 聊天发送 gate 继续使用 `co doctor --json providers.pi`，不得用 Pi CLI 可执行性替代。

## 6. 测试代码

- [x] 6.1 在本提案 `tests/` 目录编写真实测试，并已同步到根测试套件（tests/server/pi-*、tests/spec/test_pi-*）。
- [x] 6.2 Server 单测覆盖 Pi provider normalization、doctor schema 和 request build。
- [x] 6.3 Server/WebSocket 测试覆盖 Pi 发送（pi-command → co-request-v1 provider=pi）、abort（provider=pi 写入 abort request + target_turn_id）、unavailable gate（providers.pi=false 不建草稿/不写 pending request）和不 spawn Pi。
- [x] 6.4 前端业务测试覆盖创建 Pi 会话、进入 Pi 会话和发送 Pi 消息（spec 静态断言 + Playwright E2E）。
- [x] 6.5 Workflow read model 测试覆盖 `pi:*` linked/unlinked 两种场景。
- [x] 6.6 设置页或诊断测试覆盖 fake Pi CLI 可用（commandPath/version 无 secrets）和不可用（PATH 中无 pi 返回明确错误）。

## 7. 验证

- [x] 7.1 运行新增 server 测试。
- [x] 7.2 运行新增前端/spec 测试（spec suite 全部通过，openCode provider 契约断言已兼容 pi）。
- [x] 7.3 运行与 provider/session 相关的现有回归测试。
- [x] 7.4 运行 `pnpm run typecheck`。
- [x] 7.5 运行 `oz validate 2026-05-15-28-引入Pi为第三手动会话Provider --json`。

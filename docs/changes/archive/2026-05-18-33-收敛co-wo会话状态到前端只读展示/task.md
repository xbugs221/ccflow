# 任务

## 1. 审计生命周期状态来源

- [x] 1.1 标出 `useChatComposerState` 中发送后直接写入 provider running 的逻辑。
- [x] 1.2 标出 `useChatRealtimeHandlers` 中直接追加 provider assistant realtime message 的逻辑。
- [x] 1.3 标出 `useChatSessionState` 和 `useSessionProtection` 中用本地 `processingSessions` 反推 `isLoading` 的逻辑。
- [x] 1.4 标出 workflow 详情和 child session 同时依赖 co/wo 状态的边界。

## 2. 收敛前端状态模型

- [x] 2.1 将发送后的本地状态限定为 pending dispatch，不直接声明 provider session running。
- [x] 2.2 将运行态和可停止态改为由 co `session-status` / `active_turn_id` 或 read model 派生。
- [x] 2.3 将 workflow stage/run 展示保持为 wo read model，不让 chat 本地状态覆盖。
- [x] 2.4 清理或降级 `processingSessions`，只保留必要的 UI protection 语义。

## 3. 收敛消息渲染来源

- [x] 3.1 统一 Codex、OpenCode、Pi 的 provider content event 处理，不直接写最终 assistant transcript。
- [x] 3.2 将 provider content/complete/projects_updated 转为 read model invalidation 或 debounced reload。
- [x] 3.3 保留乐观用户消息，并由持久化消息确认、失败或超时收敛。
- [x] 3.4 确保工具卡片、reasoning、文件变更和正文只由会话消息转换逻辑渲染。

## 4. 精简运行中 UI

- [x] 4.1 从 `ChatComposer` 删除底部 `ProcessingStatus` 渲染。
- [x] 4.2 删除或收敛不再使用的 `ProcessingStatus` 组件和相关测试预期。
- [x] 4.3 保留发送按钮变停止按钮的交互，并修正 abort 目标必须来自 co active turn。
- [x] 4.4 确认断线提示、附件上传、模型选择和 follow latest 不受影响。

## 5. 编写真实测试

- [x] 5.1 在 `docs/changes/33-收敛co-wo会话状态到前端只读展示/tests/` 编写 provider 推送一致性测试，覆盖 Codex、OpenCode、Pi。
- [x] 5.2 编写重复通知不重复渲染测试，覆盖 content、projects_updated、complete 组合。
- [x] 5.3 编写路由刷新后从 co 恢复停止按钮状态的测试。
- [x] 5.4 编写 workflow child session 使用 wo stage + co turn 状态组合展示的测试（新增 `tests/spec/33-converge-workflow-child-session-wo-co.spec.ts`，验证 execution child session 展示 wo change_name 且 chat composer 可用，刷新后状态一致）。
- [x] 5.5 编写底部状态条删除但停止按钮仍可用的测试。
- [x] 5.6 执行阶段将测试按来源命名移动到根 `tests/`，并更新旧测试预期。

## 6. 验证

- [x] 6.1 运行新增和受影响的 Playwright spec（新增 `tests/spec/33-converge-realtime-no-direct-transcript.spec.ts`，验证 realtime agent_message 不进入 DOM transcript）。
- [x] 6.2 运行相关 server/unit 测试，确认 co/wo read model 合约未破坏。
- [x] 6.3 运行 `pnpm test` 或仓库当前 canonical 测试入口。
- [x] 6.4 运行 `oz validate 33-收敛co-wo会话状态到前端只读展示 --json`。

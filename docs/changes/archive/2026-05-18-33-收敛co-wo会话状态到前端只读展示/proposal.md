# 收敛 co/wo 会话状态到前端只读展示

## 问题

前端聊天当前同时承担了发送交互、消息渲染和会话生命周期推断。`useChatComposerState` 在发送后立即设置 `isLoading`、`processingStatus` 和 `processingSessions`；`useChatRealtimeHandlers` 又根据 `session-status`、`*-complete`、`*-error`、`session-aborted` 等事件修改同一批状态；`useChatSessionState` 还会在路由加载和 `processingSessions` 变化时补写运行态。

这与 cbw 当前架构不一致：会话生命周期已经下放给 co，workflow 生命周期已经下放给 wo。cbw 只应负责网页端交互展示、发送用户意图、读取权威状态和渲染权威消息。当前前端复制生命周期后，Codex、OpenCode、Pi 三个 provider 都可能出现严重的推送渲染错乱：

- realtime placeholder 和持久化消息混排、重复或顺序错误。
- 本地 `processingSessions` 与 co 的 `active_turn_id/status` 不一致。
- workflow 子会话状态与 wo run state 脱节。
- 底部 `ProcessingStatus` 与发送按钮切换成停止按钮重复表达运行态。

## 目标

把 cbw 前端重新收敛为薄展示层：

```text
用户操作
  |
  v
cbw Web: 发送 intent + 乐观展示用户消息
  |
  v
co: provider 会话和 turn 生命周期权威来源
wo: workflow run 和 stage 生命周期权威来源
  |
  v
cbw Web: 读取状态和消息 read model 后渲染
```

本变更要修复 Codex、OpenCode、Pi 三个 provider 的前端消息推送渲染错乱，并移除底部运行状态条。运行中状态只通过发送按钮变为停止按钮表达；消息正文和工具卡片来自权威 read model，而不是临时 WebSocket 内容直接写入最终 transcript。

## 范围

- 梳理并收敛 `src/components/chat/hooks/useChatComposerState.ts`、`useChatRealtimeHandlers.ts`、`useChatSessionState.ts` 的生命周期职责。
- 移除前端对 provider 生命周期的重复推断，尤其是发送后立即把具体会话标记为 processing 的逻辑。
- 明确 Codex、OpenCode、Pi 的 WebSocket 事件只做状态刷新、ack、错误提示和 read model invalidation，不直接制造最终 assistant transcript。
- 保留乐观用户消息，但必须由持久化会话消息确认、失败或超时清理。
- 移除 `ChatComposer` 底部 `ProcessingStatus` 展示，保留发送按钮切换为停止按钮。
- 保持 workflow 页面从 wo read model 展示阶段、运行中和中断状态，不让 chat 本地状态覆盖 wo 事实。

## 非目标

- 不修改 co 或 wo 的状态机语义。
- 不重做聊天 UI 样式。
- 不改变 provider 命令协议的业务字段，除非只是删除前端不应依赖的本地镜像字段。
- 不重写历史搜索、项目发现、Git、Shell 或文件树功能。
- 不删除已有结构化工具渲染能力。

## 测试策略

执行阶段需要在 `docs/changes/33-收敛co-wo会话状态到前端只读展示/tests/` 写真实测试代码，再按来源迁移到根 `tests/`。测试应覆盖真实业务路径，而不是组件存在性：

- Codex、OpenCode、Pi 在运行中收到 provider realtime 消息时，不直接把临时 assistant 内容渲染成最终 transcript。
- 对三个 provider，持久化 read model 更新后消息按权威顺序出现，重复推送不会重复显示。
- 会话运行态来自 co 的 `session-status` / `active_turn_id`，路由切换和刷新后仍能恢复停止按钮状态。
- workflow 子会话页面只根据 wo run state 和 co session status 展示运行中，不被本地 `processingSessions` 残留污染。
- 发送后底部不出现 `ProcessingStatus`、`esc to stop`、tokens 计数等状态条内容，停止按钮仍可中断当前 turn。

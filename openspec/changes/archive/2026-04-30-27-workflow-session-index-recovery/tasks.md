## 1. 控制面事件与索引健康模型

- [x] 1.1 在 workflow read/write model 中增加 `controllerEvents` 或等价 stage warning 字段，读取旧数据时默认为空。
- [x] 1.2 实现 `appendWorkflowControllerEvent`，保证事件包含 `type`、`stageKey`、`provider`、`message`、`createdAt`，可选包含 `sessionId`。
- [x] 1.3 实现 `buildWorkflowControlPlaneReadModel` 或等价 read model 组装逻辑，把索引异常和恢复事件映射到阶段树。
- [x] 1.4 验收：`node --test tests/spec/test_project_workflow_control_plane_index_recovery.js` 全部通过。

## 2. Auto-runner 去重与索引校验

- [x] 2.1 提取 action key 和去重判断为可测试逻辑，输入包含 project、workflow、action、runnerState。
- [x] 2.2 在 `completedKeys` / `inFlightKeys` 命中时检查 workflow 是否仍有匹配 stage 的 child session 索引。
- [x] 2.3 当索引缺失时返回 `index_missing` 恢复决策，并允许清除对应内存 key。
- [x] 2.4 验收：`node --test tests/spec/test_workflow_session_index_recovery.js --test-name-pattern "completedKey"` 全部通过。

## 3. Provider orphan 扫描与补挂

- [x] 3.1 实现 Codex CLI 会话候选扫描，限定 `~/.codex/sessions/YYYY/MM/DD/*.jsonl` 中当前项目和时间窗口。
- [x] 3.2 实现 Claude Code 会话候选扫描，限定 `~/.claude/projects/<encoded-project-path>/` 下当前项目会话。
- [x] 3.3 实现 `recoverWorkflowActionSessionIndex`，唯一高置信候选补写 workflow 内部会话索引并记录 `orphan_recovered`。
- [x] 3.4 多个候选时记录 `orphan_ambiguous`，不得自动绑定任意候选。
- [x] 3.5 验收：`node --test tests/spec/test_workflow_session_index_recovery.js --test-name-pattern "orphan"` 全部通过。

## 4. Orphan 隔离与重建

- [x] 4.1 实现 `planWorkflowProviderOrphanCleanup`，只选择当前项目内未登记且匹配 action 的可疑会话。
- [x] 4.2 实现 quarantine 执行逻辑，将候选移动到 `.ccflow/orphan-sessions/quarantine/<provider>/<sessionId>/` 并写 manifest。
- [x] 4.3 保证任何已登记到 workflow 的 provider session 不会被移动、删除或改写。
- [x] 4.4 无可疑候选时清除对应 action 去重状态，记录 `session_rebuild_allowed` 并允许新会话创建。
- [x] 4.5 验收：`node --test tests/spec/test_workflow_session_index_recovery.js --test-name-pattern "隔离|重建"` 全部通过。

## 5. Runner 集成与端到端验收

- [x] 5.1 将索引健康检查、orphan 恢复、隔离和重建流程接入 `runWorkflowAutoOnce`。
- [x] 5.2 确保 `registerWorkflowChildSession` 写回失败时不会把 action 加入 `completedKeys`。
- [x] 5.3 更新 `tests/spec/README.md` 中的运行说明，保持新增验收测试为固定标准。
- [x] 5.4 验收：`openspec/changes/27-workflow-session-index-recovery/test_cmd.sh` 全部通过。

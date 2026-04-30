## Why

工作流自动 runner 目前把内存去重状态当作“已启动”的依据，但工作流控制面真正依赖的是 `workflow.chat` / `childSessions` 里的内部会话索引。一旦 provider 会话已经启动但索引写回失败、被清理或变成陈旧记录，就会出现旧会话找不到、新会话也不再自动触发的断口。

## What Changes

- 增加工作流内部会话索引恢复能力：自动 runner 在跳过重复 action 前必须核对持久化索引仍然存在且有效。
- 增加 provider orphan 会话识别能力：当 workflow 缺少索引时，扫描 Claude Code / Codex CLI 的固定会话存储，尝试找回同项目、同阶段的高置信会话。
- 增加安全隔离流程：重建内部会话前，仅对未被任何 workflow 明确登记且匹配当前项目的可疑 provider 会话执行隔离，避免误伤已登记会话。
- 增加控制器可见状态：索引缺失、索引陈旧、orphan 隔离、会话重建都必须写入 workflow 控制面事件或 stage warning，不能静默处理。
- 调整 auto-runner 去重语义：`completedKeys` / `inFlightKeys` 只能防抖，不能覆盖持久化控制面事实。

## Capabilities

### New Capabilities
- `workflow-session-index-recovery`: 覆盖工作流内部会话索引丢失后的检测、找回、隔离和重触发行为。

### Modified Capabilities
- `project-workflow-control-plane`: 工作流控制面需要展示并持久化内部会话索引异常和恢复状态。

## Impact

- `server/workflow-auto-runner.js`: 调整 action 去重、索引校验、orphan 扫描和重触发策略。
- `server/workflows.js`: 增加工作流控制器事件或 stage warning 的持久化读写与 child session 索引恢复入口。
- `server/openai-codex.js` / `server/claude-sdk.js` 相关会话发现逻辑：复用固定 provider 会话路径解析，限定项目范围扫描。
- `tests/spec/`: 增加验收测试，覆盖索引缺失、orphan 补挂、隔离后重建和已登记会话不被误伤。

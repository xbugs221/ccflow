# OpenSpec Acceptance Tests

本目录存放 OpenSpec 派生的验收测试。测试描述业务行为，不依赖实现细节；实现完成后必须全部通过。

## 24-session-management-refactor

- `test_session_management_refactor.js`: 派生自 `openspec/changes/24-session-management-refactor/specs/session-management-refactor/spec.md`，覆盖 ccflow 会话身份、并发绑定、pending 恢复、事件重放、历史校准和 steer 干预。

## 26-workflow-stage-provider-selection

- `workflow-stage-provider.spec.js`: 派生自 `openspec/changes/26-workflow-stage-provider-selection/specs/workflow-stage-provider-selection/spec.md` 和 `openspec/changes/26-workflow-stage-provider-selection/specs/project-workflow-control-plane/spec.md`，覆盖工作流各阶段 provider 配置（创建时预设、运行时调整、launcher payload 分发、旧工作流向后兼容）。

## 27-workflow-session-index-recovery

- `test_workflow_session_index_recovery.js`: 派生自 `openspec/changes/27-workflow-session-index-recovery/specs/workflow-session-index-recovery/spec.md`，覆盖内部会话索引缺失、provider orphan 找回、隔离与重建。
- `test_project_workflow_control_plane_index_recovery.js`: 派生自 `openspec/changes/27-workflow-session-index-recovery/specs/project-workflow-control-plane/spec.md`，覆盖工作流详情 read model 对索引异常和恢复状态的展示。

## 28-add-opencode-provider-support

- `opencode-provider-integration.spec.js`: 派生自 `openspec/changes/28-add-opencode-provider-support/specs/opencode-provider-integration/spec.md`。本变更范围已收窄至 OpenCode UI/类型脚手架，因此该测试只静态校验 `SessionProvider`、`AgentProvider`、`AGENT_PROVIDERS`、`AUTH_STATUS_ENDPOINTS`、agent 选项卡视觉配置以及聊天空状态文案占位是否就位；OpenCode 后端 SDK、REST 路由、会话发现、WebSocket、工作流执行属于后续独立变更，不在本测试范围内。

## 29-merge-upstream-critical-fixes

- `upstream-critical-fixes.spec.js`: 派生自 `openspec/changes/29-merge-upstream-critical-fixes/specs/upstream-critical-fixes/spec.md`，覆盖安全 frontmatter 解析、Claude CLI 路径传递、SDK permission 语义、二进制下载和 Service Worker 缓存修复。

## 运行

```bash
# 运行全部 Playwright spec 测试
pnpm exec playwright test tests/spec/workflow-stage-provider.spec.js

# 或运行单个变更的验收测试
node --test tests/spec/test_session_management_refactor.js

# 运行 27-workflow-session-index-recovery 验收测试
openspec/changes/27-workflow-session-index-recovery/test_cmd.sh

# 运行 28-add-opencode-provider-support 验收测试
openspec/changes/28-add-opencode-provider-support/test_cmd.sh

# 运行 29-merge-upstream-critical-fixes 验收测试
openspec/changes/29-merge-upstream-critical-fixes/test_cmd.sh

# 或分别运行各测试文件
node --test tests/spec/test_workflow_session_index_recovery.js
node --test tests/spec/test_project_workflow_control_plane_index_recovery.js
node --test tests/spec/opencode-provider-integration.spec.js
node --test tests/spec/upstream-critical-fixes.spec.js
```

这些测试是验收标准。进入实现阶段后，agent 只能修改实现代码，不能修改这些测试来降低验收标准。

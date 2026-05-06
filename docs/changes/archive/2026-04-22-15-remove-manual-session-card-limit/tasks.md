## 1. 项目主页会话数据修正

- [x] 1.1 调整 `server/projects.js` 的项目快照构建逻辑，移除项目主页手动会话的固定 5 条截断
- [x] 1.2 保持现有排序、隐藏/归档过滤和 `sessionMeta.total` 语义一致，避免影响侧边栏分页接口
- [x] 1.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/project-workflow-control-plane.spec.js --grep "项目主页手动会话超过 5 个时仍展示全部已加载卡片"` 全部通过

## 2. 验收产物与回归保护

- [x] 2.1 在 `tests/spec/project-workflow-control-plane.spec.js` 增加超过 5 个手动会话的真实业务场景验收测试
- [x] 2.2 维护 `tests/spec/README.md` 与 `openspec/changes/1-remove-manual-session-card-limit/test_cmd.sh`，确保调度器只运行本次相关验收测试
- [x] 2.3 验收：`openspec/changes/1-remove-manual-session-card-limit/test_cmd.sh` 退出码为 0

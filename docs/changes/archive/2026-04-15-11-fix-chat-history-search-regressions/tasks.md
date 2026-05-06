## 1. 搜索覆盖范围修复

- [x] 1.1 调整聊天全文搜索后端的数据源，确保 Claude 搜索覆盖全部可见会话而不是项目首屏分页结果
- [x] 1.2 校准搜索结果载荷，保证结果包含恢复项目与 provider 上下文所需的最小字段
- [x] 1.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-history-search-regressions.spec.js -g "returns a hit when the keyword only exists in the sixth visible Claude session"` 全部通过

## 2. 搜索结果跳转修复

- [x] 2.1 调整搜索结果点击协议和前端会话解析逻辑，使返回结果不依赖当前 `projects` 缓存也能打开
- [x] 2.2 保持现有命中滚动和高亮逻辑在新跳转协议下继续可用
- [x] 2.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-history-search-regressions.spec.js -g "opens an orphan Codex search result even when the session is not present in the current project cache"` 全部通过

## 3. 搜索状态反馈补齐

- [x] 3.1 将搜索面板改为显式状态机，展示查询中、无结果和失败三类状态
- [x] 3.2 确保空结果和失败信息在搜索面板中可见，而不是只写入控制台
- [x] 3.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-history-search-regressions.spec.js -g "shows a visible loading state while chat search is in flight|shows an explicit empty state when chat search returns no matches|shows an explicit error state when chat search fails"` 全部通过

## 4. 验收产物对齐

- [x] 4.1 保持 proposal、design、spec、`tests/spec/chat-history-search-regressions.spec.js`、`tests/spec/README.md` 与变更内 `test_cmd.sh` 一致
- [x] 4.2 确认 `/apply` 阶段只允许修改实现代码，不允许放宽本次新增验收测试
- [x] 4.3 验收：`bash openspec/changes/archive/2026-04-15-11-fix-chat-history-search-regressions/test_cmd.sh` 全部通过

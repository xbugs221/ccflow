## 1. 聊天全文搜索后端

- [x] 1.1 新增统一聊天搜索 API，支持按关键词扫描 Claude 与 Codex 历史聊天文本
- [x] 1.2 为搜索结果返回项目、provider、session、命中片段与稳定 `messageKey`
- [x] 1.3 将 transcript 中可见的 user、assistant、reasoning 与工具文本纳入搜索提取范围
- [x] 1.4 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-history-full-text-search.spec.js -g "returns a hit when the keyword only exists in an older Claude assistant message|returns a hit when the keyword only exists in a Codex user message|returns hits for visible reasoning or tool text in the transcript|returns separate message-level results when the same keyword hits multiple sessions|returns separate message-level results when the same keyword appears in multiple messages of one session"` 全部通过

## 2. 会话定位与命中高亮

- [x] 2.1 为 session 消息返回补充稳定 `messageKey`，使搜索结果与聊天消息能一一定位
- [x] 2.2 新增聊天搜索入口和结果列表，点击结果后打开目标 session
- [x] 2.3 在命中消息未加载时自动补齐历史消息，并在目标消息出现后滚动定位
- [x] 2.4 对当前搜索词在命中消息中的全部出现位置做可见高亮
- [x] 2.5 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-history-full-text-search.spec.js -g "clicking a search result scrolls directly to a hit that is already loaded|clicking a search result auto-loads older history until the hit message is available|opening a search result highlights every match occurrence inside the target message"` 全部通过

## 3. 验收产物与回归对齐

- [x] 3.1 保持 proposal、design、spec、`tests/spec/chat-history-full-text-search.spec.js`、`tests/spec/README.md` 与变更内 `test_cmd.sh` 一致
- [x] 3.2 确认 `/apply` 阶段不修改验收测试，只修改实现代码
- [x] 3.3 验收：`bash openspec/changes/1-add-chat-history-full-text-search/test_cmd.sh` 全部通过

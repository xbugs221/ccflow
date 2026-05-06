## 1. 搜索响应判定修复

- [x] 1.1 调整前端聊天搜索响应解析逻辑，校验 `Content-Type`、JSON 解析结果和 payload 结构
- [x] 1.2 将 `200 + HTML`、非 JSON 或异常 payload 统一进入 error 态，禁止再显示空结果
- [x] 1.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-history-search-production-routing.spec.js -g "shows an explicit error when chat search returns HTML with HTTP 200"` 全部通过

## 2. 生产搜索链路收口

- [x] 2.1 修复生产部署链路，确保认证后的 `/api/chat/search` 命中后端 API 而不是前端首页 fallback
- [x] 2.2 增加一个面向公开站点的搜索 smoke check，验证 `/api/chat/search` 返回 JSON
- [x] 2.3 验收：`pnpm exec playwright test --config playwright.spec.config.js tests/spec/chat-history-search-production-routing.spec.js -g "returns JSON for an authenticated chat search request"` 全部通过

## 3. 验收产物对齐

- [x] 3.1 保持 proposal、design、spec、`tests/spec/chat-history-search-production-routing.spec.js`、`tests/spec/README.md` 与变更内 `test_cmd.sh` 一致
- [x] 3.2 确认 `/apply` 阶段只允许修改实现代码，不允许放宽本次新增验收测试
- [x] 3.3 验收：`bash openspec/changes/3-fix-production-chat-search-routing/test_cmd.sh` 全部通过

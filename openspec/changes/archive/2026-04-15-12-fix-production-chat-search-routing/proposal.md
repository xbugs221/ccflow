## Why

线上 `https://example.com/` 已经复现到聊天搜索请求 `GET /api/chat/search?q=记忆` 返回的是前端 `index.html`，状态码还是 `200`。前端当前会把这种“200 + 非 JSON”吞成空结果，于是用户看到 `No chat history matches found.`，但这其实是生产路由或缓存链路错误，不是真正的零命中。

## What Changes

- 修正聊天搜索在生产环境中的接口链路，确保 `/api/chat/search` 命中后端 API 而不是前端 HTML fallback。
- 为聊天搜索前端增加响应格式校验，遇到 `200 + HTML`、非 JSON 或缺少结果结构时显示明确错误，而不是显示空结果。
- 增加针对搜索接口返回类型和前端错误判定的验收测试，覆盖生产链路误配这一类真实问题。

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `chat-history-full-text-search`: 增加搜索 API 返回格式约束，并要求前端把非 JSON 假成功识别为错误态而不是空结果。

## Impact

- 后端 / 部署影响：生产反代、静态 fallback、服务升级流程需要保证 `/api/chat/search` 指向后端搜索接口。
- 前端影响：搜索面板需要校验响应 `Content-Type` 和 JSON 结构，拒绝把 HTML fallback 误判为空结果。
- 验收影响：需要新增 `tests/spec/` 下的生产路由回归测试、更新 `tests/spec/README.md`，并提供变更内 `test_cmd.sh`。

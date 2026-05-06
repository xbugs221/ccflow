## Context

这次问题不是本地逻辑推断，而是已经在真实线上站点复现：登录 `https://example.com/` 后搜索 `记忆`，页面显示 `No chat history matches found.`；同时抓包看到 `/api/chat/search?q=记忆` 返回的是 `CloudCLI UI` 首页 HTML，状态码为 `200`。这说明当前系统同时存在两层缺口：

- 生产链路没有稳定保证 `/api/chat/search` 命中后端 API，可能落到反代 fallback、旧静态缓存或部分发布状态。
- 前端把“HTTP 200 但 body 不是 JSON”误判成“空结果”，掩盖了真实故障。

从用户角度看，这不是普通边缘 case，而是把生产故障伪装成业务结果，直接误导判断。

## Goals / Non-Goals

**Goals:**

- 保证聊天搜索接口在生产部署后返回 JSON API 响应，而不是 HTML fallback。
- 让前端把非 JSON、错误 `Content-Type` 和异常 payload 明确显示为错误态。
- 为生产链路增加可执行验收，避免以后再次出现“接口失效但页面显示空结果”。

**Non-Goals:**

- 本次不重做聊天搜索算法，也不扩展搜索能力范围。
- 本次不引入新的外部监控系统；只补齐当前仓库内可执行的部署后验收和前端防御。
- 本次不重构整个认证或平台模式，只针对搜索接口链路和响应校验收口。

## Decisions

### 1. 把“搜索接口必须返回 JSON”上升为显式契约

搜索成功和失败都必须返回 JSON，由后端或平台层保证 `/api/chat/search` 不会被 SPA fallback 吃掉。这样前端能稳定区分“真实零命中”和“接口链路错误”。

选择这个方向的原因：

- 线上现象已经证明仅靠状态码不够，`200` 也可能是错误页面。
- JSON 契约是搜索 UI 正常工作的最低前提，应该写进 spec 和验收。

备选方案：

- 只修前端提示，不约束接口返回：放弃。接口仍然可能继续错误回退到 HTML，只是报错更好看。
- 只修反代，不加前端校验：放弃。任何未来缓存或平台层异常仍会再次把问题伪装成空结果。

### 2. 前端以 `Content-Type` 和 payload 结构双重校验搜索响应

前端不能只看 `response.ok`。搜索请求返回后，需要校验：

- `Content-Type` 是否为 JSON
- `response.json()` 是否成功
- payload 是否包含预期字段，例如 `results`

任一条件不满足，都进入 error 态，并给出明确文案，例如“Search endpoint returned HTML instead of JSON”。

选择这个方向的原因：

- 当前代码在 `response.json().catch(() => ({}))` 后只用 `response.ok` 判定成功，正是这次假空结果的直接原因。
- 双重校验能把“网络层成功但应用层错误”从空结果里分离出来。

备选方案：

- 仅在 JSON parse 失败时报错：不够。部分错误响应可能仍是 JSON，但结构不合法。
- 仅按 `Content-Type` 判断：不够。某些错误代理可能错误标记 `application/json`。

### 3. 增加一个生产链路 smoke test，而不是只测本地 route handler

除了现有本地 Playwright / API 验收，还需要有一个面向“部署后站点”的最小检查：登录后搜索一个词，确认 `/api/chat/search` 返回 JSON，而不是 HTML 首页。这个检查可以先固化成 Playwright 验收脚本，后续接到发布流程。

选择这个方向的原因：

- 本地开发环境 route 存在，不代表生产反代、缓存、静态托管就没有偏差。
- 这次问题就是典型的“本地能跑，线上路由错了”。

备选方案：

- 继续只依赖本地测试：放弃。无法覆盖部署层退化。
- 手工 smoke test：放弃。没有可重复性，也不适合回归。

## Risks / Trade-offs

- [生产 smoke test 依赖站点可访问和登录账号] → 先把测试脚本写成可配置账号/密码或 token 的形式，默认作为发布后人工或 CI 可执行脚本。
- [前端错误判断变严格后，某些旧环境会从“空结果”变成“错误态”] → 这是预期修正，避免误导用户。
- [根因可能同时包含反代 fallback 与旧 service worker 缓存] → 同时收口接口契约和前端校验，避免只修单点。

## Migration Plan

1. 修改 `chat-history-full-text-search` spec，增加 JSON 返回契约和非 JSON 错误态要求。
2. 新增验收测试，先把“200 + HTML 不得显示空结果”与“搜索接口必须是 JSON”固定下来。
3. 修复前端搜索响应判定逻辑，改为校验 `Content-Type` 与 payload 结构。
4. 对生产部署链路补充 `/api/chat/search` smoke check，确认它不再落到前端首页。
5. 通过变更内 `test_cmd.sh` 作为本次 change 的验收入口。

## Open Questions

- 生产 smoke test 是直接打公开站点，还是先在预发布环境验证再发布到正式域名。
- 平台模式下搜索请求是否还会经过额外中间层，需要在部署文档中单独列出 `/api/chat/search` 例外规则。

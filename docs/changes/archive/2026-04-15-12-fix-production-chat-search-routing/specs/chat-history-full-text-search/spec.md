## MODIFIED Requirements

### Requirement: 搜索交互必须提供可见的查询状态反馈
系统 SHALL 在用户提交聊天全文搜索后提供显式反馈，覆盖查询中、无结果和失败三种状态，而不是只在控制台记录错误或在无命中时完全不渲染任何状态区域；当搜索接口返回非 JSON、错误 `Content-Type`、HTML fallback 或缺少预期字段时，系统 MUST 将其视为错误而不是空结果。

#### Scenario: 搜索请求进行中
- **WHEN** 用户提交一个聊天全文搜索，且请求尚未完成
- **THEN** 系统 SHALL 在搜索面板中显示明确的查询中状态

#### Scenario: 搜索无命中
- **WHEN** 用户提交一个聊天全文搜索，且服务端返回零条结果
- **THEN** 系统 SHALL 显示明确的无结果提示，而不是让结果区域完全消失

#### Scenario: 搜索请求失败
- **WHEN** 用户提交一个聊天全文搜索，且服务端返回错误或网络失败
- **THEN** 系统 SHALL 显示明确的失败提示和可理解的错误反馈

#### Scenario: 搜索接口返回 HTML fallback 且状态码为 200
- **WHEN** 用户提交一个聊天全文搜索，且接口返回 `200` 但 body 实际是前端 HTML 页面或其他非 JSON 内容
- **THEN** 系统 SHALL 显示明确错误，而不是显示 `No chat history matches found.`

## ADDED Requirements

### Requirement: 聊天搜索接口必须返回可判定的 JSON API 响应
系统 SHALL 让聊天搜索接口在成功和失败两种情况下都返回可判定的 JSON API 响应，并保证认证后的 `/api/chat/search` 请求不会落到前端 SPA HTML fallback。

#### Scenario: 认证后的搜索请求返回 JSON
- **WHEN** 已认证用户请求 `/api/chat/search?q=<keyword>`
- **THEN** 系统 SHALL 返回 `application/json` 响应，并包含可解析的搜索结果或错误对象

#### Scenario: 部署后搜索接口不再回退到前端首页
- **WHEN** 系统完成部署并对公开站点执行聊天搜索 smoke test
- **THEN** `/api/chat/search` SHALL 命中后端搜索接口，而不是返回带有 `CloudCLI UI` 等首页标识的 HTML 文档

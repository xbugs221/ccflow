## Purpose

定义跨会话聊天全文搜索的索引范围、结果定位和查询状态反馈，确保用户能从历史消息命中并回到对应上下文。

## Requirements

### Requirement: 用户可以对全部聊天记录的可见文本做跨会话全文搜索
系统 SHALL 支持对历史聊天 transcript 中全部可见文本做统一搜索，覆盖 Claude 与 Codex 的全部可见历史会话，而不是仅匹配项目名、session 摘要、当前打开的会话或项目列表首屏已加载的少量会话。

#### Scenario: 关键词命中旧 Claude 会话中的助手消息
- **WHEN** 用户搜索一个仅出现在较早 Claude 会话助手回复中的关键词
- **THEN** 系统 SHALL 返回该命中结果，即使该 session 当前未打开且该关键词不在项目名或会话摘要中

#### Scenario: 关键词命中 Codex 会话中的用户消息
- **WHEN** 用户搜索一个仅出现在 Codex 历史会话用户消息中的关键词
- **THEN** 系统 SHALL 返回对应的 Codex 会话命中结果

#### Scenario: 关键词命中 transcript 中的工具或 reasoning 文本
- **WHEN** 用户搜索一个仅出现在聊天 transcript 可见的工具文本或 reasoning 摘要中的关键词
- **THEN** 系统 SHALL 返回对应消息级命中结果

#### Scenario: 关键词仅存在于某项目第六个及之后的 Claude 可见会话
- **WHEN** 用户搜索一个仅出现在某项目最近五条之外的 Claude 可见历史会话中的关键词
- **THEN** 系统 SHALL 返回该命中结果，而不是因为项目列表首屏分页而漏掉该会话

### Requirement: 搜索结果以消息为粒度返回可定位的命中信息
系统 SHALL 以消息级粒度返回搜索结果，并为每个结果提供项目、provider、session、命中文字片段和稳定的消息定位标识，以支持后续跳转。

#### Scenario: 同一关键词命中多个会话
- **WHEN** 同一个搜索词在多个项目或多个 session 中出现
- **THEN** 系统 SHALL 返回多条独立结果，并为每条结果包含其所属项目、provider、session 与命中片段

#### Scenario: 同一会话中同词命中多条消息
- **WHEN** 同一个搜索词在同一 session 的多条不同消息中出现
- **THEN** 系统 SHALL 将这些命中作为独立结果返回，而不是只返回该 session 一次

### Requirement: 点击搜索结果后系统必须定位到命中消息
系统 SHALL 在用户点击某条搜索结果后打开对应会话，并在消息加载完成后滚动到该条命中消息，而不是仅停留在 session 顶部或底部；只要结果已被返回，系统 MUST 能解析到该结果所属的项目和 provider，即使该 session 不在当前前端 `projects` 状态中。

#### Scenario: 命中消息已在当前加载窗口中
- **WHEN** 用户点击一条命中结果，且目标消息已经出现在当前会话已加载的消息列表中
- **THEN** 系统 SHALL 直接滚动到该条命中消息

#### Scenario: 命中消息不在当前加载窗口中
- **WHEN** 用户点击一条命中结果，且目标消息尚未被当前会话窗口加载
- **THEN** 系统 SHALL 自动补齐足够的历史消息，并在目标消息出现后滚动到该条命中消息

#### Scenario: 搜索结果对应的 Codex 会话不在当前项目列表缓存中
- **WHEN** 后端返回一条来自磁盘历史但尚未出现在当前前端 `projects` 状态里的 Codex 命中结果，且用户点击该结果
- **THEN** 系统 SHALL 仍然打开正确的 Codex 会话并定位到命中消息，而不是停留在未选择项目或错误会话状态

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

### Requirement: 聊天搜索接口必须返回可判定的 JSON API 响应
系统 SHALL 让聊天搜索接口在成功和失败两种情况下都返回可判定的 JSON API 响应，并保证认证后的 `/api/chat/search` 请求不会落到前端 SPA HTML fallback。

#### Scenario: 认证后的搜索请求返回 JSON
- **WHEN** 已认证用户请求 `/api/chat/search?q=<keyword>`
- **THEN** 系统 SHALL 返回 `application/json` 响应，并包含可解析的搜索结果或错误对象

#### Scenario: 部署后搜索接口不再回退到前端首页
- **WHEN** 系统完成部署并对公开站点执行聊天搜索 smoke test
- **THEN** `/api/chat/search` SHALL 命中后端搜索接口，而不是返回带有 `CloudCLI UI` 等首页标识的 HTML 文档

### Requirement: 当前搜索词在命中消息中必须可见高亮
系统 SHALL 在用户从搜索结果进入目标会话后，对当前搜索词在命中消息中的出现位置做可见高亮，便于用户立即识别命中上下文。

#### Scenario: 搜索结果打开后高亮命中词
- **WHEN** 用户点击一条搜索结果打开目标会话
- **THEN** 目标消息中与当前搜索词匹配的文本 SHALL 以可见高亮样式呈现

#### Scenario: 同一条消息中关键词出现多次
- **WHEN** 目标消息中同一个搜索词出现多次
- **THEN** 系统 SHALL 对该消息中的所有命中位置做高亮，而不是只高亮第一处

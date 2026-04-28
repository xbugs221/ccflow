## ADDED Requirements

### Requirement: 用户可以对全部聊天记录的可见文本做跨会话全文搜索
系统 SHALL 支持对历史聊天 transcript 中全部可见文本做统一搜索，覆盖 Claude 与 Codex 的历史会话，而不是仅匹配项目名、session 摘要或当前打开的会话。

#### Scenario: 关键词命中旧 Claude 会话中的助手消息
- **WHEN** 用户搜索一个仅出现在较早 Claude 会话助手回复中的关键词
- **THEN** 系统 SHALL 返回该命中结果，即使该 session 当前未打开且该关键词不在项目名或会话摘要中

#### Scenario: 关键词命中 Codex 会话中的用户消息
- **WHEN** 用户搜索一个仅出现在 Codex 历史会话用户消息中的关键词
- **THEN** 系统 SHALL 返回对应的 Codex 会话命中结果

#### Scenario: 关键词命中 transcript 中的工具或 reasoning 文本
- **WHEN** 用户搜索一个仅出现在聊天 transcript 可见的工具文本或 reasoning 摘要中的关键词
- **THEN** 系统 SHALL 返回对应消息级命中结果

### Requirement: 搜索结果以消息为粒度返回可定位的命中信息
系统 SHALL 以消息级粒度返回搜索结果，并为每个结果提供项目、provider、session、命中文字片段和稳定的消息定位标识，以支持后续跳转。

#### Scenario: 同一关键词命中多个会话
- **WHEN** 同一个搜索词在多个项目或多个 session 中出现
- **THEN** 系统 SHALL 返回多条独立结果，并为每条结果包含其所属项目、provider、session 与命中片段

#### Scenario: 同一会话中同词命中多条消息
- **WHEN** 同一个搜索词在同一 session 的多条不同消息中出现
- **THEN** 系统 SHALL 将这些命中作为独立结果返回，而不是只返回该 session 一次

### Requirement: 点击搜索结果后系统必须定位到命中消息
系统 SHALL 在用户点击某条搜索结果后打开对应会话，并在消息加载完成后滚动到该条命中消息，而不是仅停留在 session 顶部或底部。

#### Scenario: 命中消息已在当前加载窗口中
- **WHEN** 用户点击一条命中结果，且目标消息已经出现在当前会话已加载的消息列表中
- **THEN** 系统 SHALL 直接滚动到该条命中消息

#### Scenario: 命中消息不在当前加载窗口中
- **WHEN** 用户点击一条命中结果，且目标消息尚未被当前会话窗口加载
- **THEN** 系统 SHALL 自动补齐足够的历史消息，并在目标消息出现后滚动到该条命中消息

### Requirement: 当前搜索词在命中消息中必须可见高亮
系统 SHALL 在用户从搜索结果进入目标会话后，对当前搜索词在命中消息中的出现位置做可见高亮，便于用户立即识别命中上下文。

#### Scenario: 搜索结果打开后高亮命中词
- **WHEN** 用户点击一条搜索结果打开目标会话
- **THEN** 目标消息中与当前搜索词匹配的文本 SHALL 以可见高亮样式呈现

#### Scenario: 同一条消息中关键词出现多次
- **WHEN** 目标消息中同一个搜索词出现多次
- **THEN** 系统 SHALL 对该消息中的所有命中位置做高亮，而不是只高亮第一处

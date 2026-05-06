## MODIFIED Requirements

### Requirement: 用户可以通过会话 thread 标识搜索并打开会话
系统 SHALL 在聊天历史搜索中支持按会话身份搜索会话本身，而不仅按 transcript 可见文本返回消息命中。用户打开左侧导航栏搜索弹窗时，系统 MUST 要求用户明确选择搜索模式：`JSONL 文件名/thread` 或 `文件内容`。在 `JSONL 文件名/thread` 模式下，系统 SHALL 只搜索会话身份字段，不搜索 transcript 内容；在 `文件内容` 模式下，系统 SHALL 只搜索 transcript 可见文本，不搜索 JSONL 文件名或 thread。对 Codex 会话，系统 MUST 将 JSONL 文件名解析出的 thread 标识纳入 `JSONL 文件名/thread` 模式：若文件名形如 `rollout-YYYY-MM-DDTHH-MM-SS-<thread>.jsonl`，则 `<thread>` 为可搜索 thread；若不匹配该格式，则使用去掉 `.jsonl` 后的 basename 作为可搜索 thread。该 thread 是 `mc` 工作流程序运行时输出、并用于 `codex resume <thread>` 的恢复标识；系统 MUST 保证 thread 搜索结果打开后使用同一个可恢复标识读取和继续会话。

#### Scenario: 用户必须选择搜索模式
- **WHEN** 用户点击左侧导航栏搜索按钮
- **THEN** 搜索弹窗 SHALL 展示 `JSONL 文件名/thread` 和 `文件内容` 两种互斥模式
- **AND** 用户提交搜索前 SHALL 能明确看出当前模式

#### Scenario: 搜索 Codex rollout 文件名中的 thread 段
- **WHEN** 用户选择 `JSONL 文件名/thread` 模式
- **AND** 磁盘存在 `rollout-2026-04-30T00-27-02-019dda10-ba67-7973-ac49-3ae9102d38cd.jsonl`
- **AND** 用户搜索 `019dda10-ba67-7973-ac49-3ae9102d38cd`
- **THEN** 系统 SHALL 返回对应 Codex 会话
- **AND** 搜索结果 SHALL 显示该 thread 标识，便于用户确认命中的会话身份
- **AND** 点击结果后系统用于打开和继续 Codex 会话的标识 SHALL 为该 thread，而不是完整文件名或带时间戳前缀的字符串

#### Scenario: 搜索完整 Codex JSONL 文件名
- **WHEN** 用户选择 `JSONL 文件名/thread` 模式
- **AND** 用户搜索 `rollout-2026-04-30T00-27-02-019dda10-ba67-7973-ac49-3ae9102d38cd.jsonl`
- **THEN** 系统 SHALL 返回与搜索 thread 段相同的 Codex 会话

#### Scenario: thread 命中不依赖消息正文
- **WHEN** 用户选择 `JSONL 文件名/thread` 模式
- **AND** 用户搜索的 thread 标识不存在于该会话任意 transcript 可见消息中
- **THEN** 系统 SHALL 仍然返回该会话级命中结果

#### Scenario: 文件内容模式不匹配 JSONL 文件名
- **WHEN** 用户选择 `文件内容` 模式
- **AND** 用户搜索一个只存在于 Codex JSONL 文件名或 thread 中、但不存在于 transcript 可见文本中的字符串
- **THEN** 系统 SHALL 返回无内容命中，而不是返回会话级 thread 命中

### Requirement: 搜索结果以消息或会话为粒度返回可定位命中信息
系统 SHALL 根据用户选择的搜索模式返回不同粒度结果。`文件内容` 模式 MUST 返回消息级结果，并保持现有项目、provider、session、命中文字片段和稳定消息定位标识；`JSONL 文件名/thread` 模式 MUST 返回会话级结果，并包含项目、provider、session、thread、可展示摘要和足够的路由上下文。对 Codex 会话，`sessionId` MUST 是可传给 `codex resume` 的 thread 标识；完整 JSONL 文件名只能作为匹配和展示辅助字段。点击会话级结果 SHALL 打开目标会话，但不要求滚动到具体消息。

#### Scenario: 会话级 thread 命中可以打开目标会话
- **WHEN** 用户点击一条 thread 会话级搜索结果
- **THEN** 系统 SHALL 打开该结果所属的项目会话或工作流子会话
- **AND** 系统 SHALL NOT 要求 URL 中携带 `messageKey`

#### Scenario: workflow runner 输出的 thread 可被搜索打开
- **WHEN** 用户选择 `JSONL 文件名/thread` 模式
- **AND** Go runner 状态或进程行中记录了 Codex thread `019dda10-ba67-7973-ac49-3ae9102d38cd`
- **AND** 对应 Codex JSONL 文件存在于 `~/.codex/sessions/**`
- **THEN** 用户 SHALL 能通过该 thread 搜索并打开同一个 workflow-owned child session
- **AND** 该会话后续继续发送消息时 SHALL 使用同一 thread 恢复 Codex

#### Scenario: 同一字符串在不同模式下分别命中不同来源
- **WHEN** 同一个搜索字符串同时存在于某会话 thread 标识和一条 transcript 可见消息中
- **THEN** `JSONL 文件名/thread` 模式 SHALL 只返回会话级 thread 结果
- **AND** `文件内容` 模式 SHALL 只返回消息级内容结果

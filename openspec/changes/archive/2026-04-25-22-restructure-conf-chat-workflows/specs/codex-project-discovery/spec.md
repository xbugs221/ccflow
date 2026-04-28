# codex-project-discovery Specification

## ADDED Requirements

### Requirement: 终端 Codex 会话必须导入顶层 chat

系统 MUST 将从同一项目路径扫描到的 standalone 终端 Codex 会话导入项目 `conf.json` 的顶层 `chat` 分组。

#### Scenario: 终端 Codex 会话使用第一条用户指令作为标题

- **WHEN** 用户在项目目录中通过终端直接启动 Codex 并发送第一条真实指令
- **AND** CCFlow 扫描到该 Codex transcript
- **THEN** 系统在顶层 `chat` 中为该 session 分配下一个编号
- **AND** 该 chat 记录的 `sessionId` 为真实 Codex session id
- **AND** 该 chat 记录的 `title` 为第一条真实用户指令文本

#### Scenario: 已导入终端会话不会重复分配编号

- **WHEN** 一个终端 Codex 会话已经存在于 `chat["<编号>"]`
- **AND** CCFlow 再次扫描同一个 transcript
- **THEN** 系统不会创建新的 `chat` 编号
- **AND** 原有记录的 `sessionId` 保持不变

#### Scenario: 终端会话不属于工作流

- **WHEN** CCFlow 扫描到项目目录中的终端 Codex 会话
- **AND** 该会话没有 workflow 归属
- **THEN** 系统只将它写入顶层 `chat`
- **AND** 系统不会为它创建 `workflows` 条目

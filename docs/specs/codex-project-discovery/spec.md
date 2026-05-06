## Purpose

Define how the project list discovers and represents Codex-backed projects in the web UI, including Codex-only projects and cross-provider deduplication behavior.

## Requirements

### Requirement: Discover Codex-only projects
The system SHALL include a project in the unified project list when Codex session history exists for a project path, even if no Claude project directory or manual project configuration exists for that path.

#### Scenario: Codex-only path appears as project
- **WHEN** a normalized project path exists in Codex session history and is absent from Claude/manual discovered projects
- **THEN** `/api/projects` includes a project entry for that path with its Codex sessions

### Requirement: Prevent duplicate project entries across providers
The system SHALL deduplicate projects by normalized absolute project path when merging Claude/manual discovered projects with Codex-discovered projects.

#### Scenario: Existing Claude project suppresses Codex duplicate
- **WHEN** a Claude project resolves to the same normalized path as a Codex-discovered project path
- **THEN** `/api/projects` returns a single project entry for that path and does not add a second Codex-only entry

### Requirement: Provide frontend-compatible defaults for Codex-only projects
For Codex-only discovered projects, the system SHALL return the standard project object shape used by the web UI, including default values for non-Codex session collections and session metadata.

#### Scenario: Codex-only project renders without missing fields
- **WHEN** a Codex-only project is returned by `/api/projects`
- **THEN** the project object includes `name`, `path`, `displayName`, `fullPath`, `sessions`, `cursorSessions`, `codexSessions`, `geminiSessions`, and `sessionMeta`

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

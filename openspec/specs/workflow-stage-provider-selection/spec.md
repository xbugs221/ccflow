## Purpose

定义 ccflow 工作流各阶段独立配置 AI provider（codex / claude）的稳定能力，包括创建时的预设、运行时修改、自动执行和手动推进时的 provider 分发。

## Requirements

### Requirement: 工作流数据模型必须支持阶段级 provider 配置

系统 MUST 在工作流记录中支持为每个阶段独立配置 provider。配置 MUST 以 `stageProviders` 字段存储，键为阶段 key，值为 `"codex"` 或 `"claude"`。未配置的阶段 MUST 默认使用 `"codex"`。该配置 MUST 随工作流一起持久化到项目配置文件中。

#### Scenario: 新建工作流时预设各阶段 provider

- **WHEN** 用户在创建工作流时展开"阶段配置"面板
- **AND** 将 planning 阶段设为 "claude"，其余保持默认
- **THEN** 工作流创建后 `stageProviders["planning"]` 为 `"claude"`
- **AND** 其余未显式配置的阶段隐式使用 `"codex"`

#### Scenario: 旧工作流读取时默认全部 codex

- **WHEN** 系统读取一个旧工作流记录
- **AND** 该记录不含 `stageProviders` 字段
- **THEN** 所有阶段的 provider 派生值为 `"codex"`
- **AND** 工作流正常展示和运行

### Requirement: 工作流 launcher config 必须携带阶段对应的 provider

系统 MUST 在 `buildWorkflowLauncherConfig()` 返回的 launcher payload 中包含该阶段对应的 provider。前端和自动执行器 MUST 以此为唯一依据决定启动哪个 provider 的会话。

#### Scenario: 获取 planning 阶段的 launcher config

- **WHEN** 后端为 planning 阶段构建 launcher config
- **AND** 该工作流的 `stageProviders["planning"]` 为 `"claude"`
- **THEN** launcher payload 中包含 `provider: "claude"`

#### Scenario: 获取未配置阶段的 launcher config

- **WHEN** 后端为 execution 阶段构建 launcher config
- **AND** 该工作流未显式配置 execution 的 provider
- **THEN** launcher payload 中包含 `provider: "codex"`

### Requirement: 后端自动执行必须按阶段 provider 启动会话

系统 MUST 在工作流自动执行时，根据 launcher config 中的 `provider` 字段决定调用 `queryCodex` 还是 `queryClaudeSDK`。子会话注册时 MUST 使用对应的 provider 值。

#### Scenario: 自动执行 planning 阶段且 provider 为 claude

- **WHEN** workflow auto runner 决定启动 planning 阶段
- **AND** launcher config 中的 provider 为 `"claude"`
- **THEN** 系统调用 `queryClaudeSDK` 而非 `queryCodex`
- **AND** 注册的子会话记录中 provider 为 `"claude"`

### Requirement: 前端手动推进必须按 launcher payload 的 provider 启动会话

系统 MUST 在用户点击"继续推进"时，从后端获取 launcher config，并使用其中指定的 provider 调用 `onNewSession()`，不再硬编码 `'codex'`。

#### Scenario: 手动推进 execution 阶段且 provider 为 codex

- **WHEN** 用户在工作流详情页点击"继续推进"
- **AND** 后端返回的 launcher payload 中 provider 为 `"codex"`
- **THEN** 系统以 codex provider 创建新会话

#### Scenario: 手动推进 archive 阶段且 provider 为 claude

- **WHEN** 用户在工作流详情页点击"继续推进"
- **AND** 后端返回的 launcher payload 中 provider 为 `"claude"`
- **THEN** 系统以 claude provider 创建新会话

## Purpose

定义 ccflow 会话身份、草稿绑定、待恢复会话、实时事件索引和 provider transcript 保留的稳定管理语义。

## Requirements

### Requirement: Stable ccflow session identity
The system SHALL treat manual route identifiers such as `c1` and `c2` as stable ccflow session identifiers that remain distinct from Claude or Codex provider session identifiers.

#### Scenario: New draft keeps its route identifier after provider binding
- **WHEN** a user creates a manual chat draft with route id `c1` and sends the first message
- **THEN** the visible route session remains `c1`
- **AND** the ccflow session index records the provider session id separately from `c1`

#### Scenario: Existing provider session id is not used as the route id
- **WHEN** Claude or Codex returns a provider session id for a pending ccflow session
- **THEN** the system binds that provider session id to the existing ccflow session id
- **AND** the system does not replace the ccflow route id with the provider session id

### Requirement: Concurrent draft binding safety
The system SHALL bind a provider session id to a draft only when the provider response matches both the ccflow session id and the start request id recorded for that draft.

#### Scenario: Multiple new sessions bind out of order
- **WHEN** a user starts drafts `c1` and `c2` in quick succession
- **AND** the provider session for `c2` is created before the provider session for `c1`
- **THEN** `c2` is bound only to the provider session created for `c2`
- **AND** `c1` is bound only to the provider session created for `c1`

#### Scenario: Stale start request cannot overwrite binding
- **WHEN** a provider session id arrives for a start request that no longer matches the draft's active start request id
- **THEN** the system rejects the binding
- **AND** the existing draft binding remains unchanged

### Requirement: Pending session recovery
The system SHALL persist pending start state before launching Claude or Codex so a page refresh or session switch can recover the draft state.

#### Scenario: Refresh during first-message startup
- **WHEN** a user sends the first message in draft `c1`
- **AND** the page refreshes before the provider session id is available
- **THEN** reloading `/session/c1` shows the pending start state
- **AND** the session is updated when the provider session id is later bound

#### Scenario: Switching away does not cancel binding
- **WHEN** a user starts draft `c1` and immediately navigates to another session
- **THEN** the backend continues the provider startup for `c1`
- **AND** returning to `/session/c1` shows the bound provider session or the recorded startup failure

### Requirement: Indexed realtime events
The system SHALL append ccflow session events with monotonically increasing `event_seq` values and use those values for replay and disconnect recovery.

#### Scenario: Reconnect replays missed events by event sequence
- **WHEN** a browser reconnects to session `c1` with the last processed event sequence
- **THEN** the backend sends all later events for `c1`
- **AND** it does not rely on `message_id` as the replay cursor

#### Scenario: Duplicate event replay is idempotent
- **WHEN** the frontend receives the same event sequence more than once
- **THEN** the frontend applies that event at most once
- **AND** the visible message list remains unchanged after duplicate replay

### Requirement: Provider transcript preservation
The system SHALL preserve Claude and Codex native jsonl files unchanged and store ccflow-specific state in the ccflow session index.

#### Scenario: History calibration does not rewrite provider jsonl
- **WHEN** the system calibrates a session from provider history
- **THEN** Claude or Codex jsonl content remains byte-for-byte unchanged
- **AND** ccflow stores message projections, revisions, and provider offsets in its own index

#### Scenario: Index overlay reconciles realtime and history
- **WHEN** realtime events show a streamed assistant message and provider history later contains the final message
- **THEN** the system updates the ccflow message projection using the indexed revision
- **AND** the frontend sees one final assistant message instead of duplicate realtime and history entries

### Requirement: Native steer intervention tracking
The system SHALL model running-session steer as an intervention inside the current turn and track its lifecycle separately from ordinary user turns.

#### Scenario: Steer is queued and injected after tool call
- **WHEN** a user sends a steer message while the assistant is running a tool call
- **THEN** the system records the steer as `accepted`
- **AND** the system marks it `queued` until the tool call finishes
- **AND** the system injects it through the provider's native steer capability after the tool call
- **AND** the system marks it `injected`

#### Scenario: Steer failure is visible
- **WHEN** a user sends a steer message after the provider session has already completed
- **THEN** the system records the steer as `failed`
- **AND** the frontend shows the steer message as failed without creating a new ordinary turn

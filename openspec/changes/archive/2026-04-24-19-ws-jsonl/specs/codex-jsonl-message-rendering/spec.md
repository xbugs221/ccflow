## ADDED Requirements

### Requirement: Codex realtime rendering matches JSONL replay
The system SHALL treat Codex JSONL session records as the canonical source for chat message semantics and SHALL render WebSocket-delivered Codex messages with the same visual structure that appears after a browser refresh reloads the session from JSONL.

#### Scenario: Realtime Codex turn remains visually stable after refresh
- **WHEN** a Codex session receives assistant text, commentary, and tool activity through WebSocket and the user refreshes the browser after the turn is persisted to JSONL
- **THEN** the reloaded chat SHALL show the same user-visible message text, tool call grouping, tool titles, statuses, and collapsed states as the realtime view.

#### Scenario: JSONL-only content is visible during realtime streaming
- **WHEN** Codex emits a persisted JSONL entry such as an Edit file command during an active turn
- **THEN** the chat SHALL show that command during realtime streaming without requiring a browser refresh.

### Requirement: Codex tool calls render as lifecycle cards
The system SHALL render each concrete Codex tool call as a distinct tool card group with a stable header, live output preview, and completion state.

#### Scenario: Running tool card shows command and latest five output lines
- **WHEN** a Codex tool call is running and receives more than five lines of output
- **THEN** its card header SHALL keep showing the tool name and issued command, and the expanded body SHALL show only the latest five output lines in chronological order.

#### Scenario: Completed tool cards are collapsed by default
- **WHEN** any Codex tool call finishes, fails, or is interrupted
- **THEN** its card SHALL default to the collapsed state while preserving an expandable detail view containing the command, output, result, and error details when present.

### Requirement: Structured Codex tool renderers remain consistent across refresh
The system SHALL use the same structured renderer for a Codex tool call during WebSocket streaming and after JSONL replay.

#### Scenario: ctx tool keeps structured rendering after refresh
- **WHEN** a Codex ctx tool such as `ctx_batch_execute` is shown during realtime streaming and the user refreshes the browser
- **THEN** the refreshed JSONL replay SHALL show the same structured ctx renderer, title, collapsed state, and result summary as the realtime view.

#### Scenario: Edit file command keeps structured rendering after refresh
- **WHEN** a Codex file-editing tool call is shown during realtime streaming and the user refreshes the browser
- **THEN** the refreshed JSONL replay SHALL show the same file-edit command title, changed-file summary, collapsed state, and expandable details as the realtime view.

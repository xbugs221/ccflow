### Requirement: Codex messages render from JSONL as the single source of truth

The system SHALL render Codex chat messages from parsed JSONL transcript data as the only message-list source. WebSocket events MUST NOT directly create, replace, or delete Codex chat messages.

#### Scenario: Running Codex turn preserves previously rendered messages
- **WHEN** a Codex turn is still running and the frontend receives additional status or update notifications
- **THEN** previously rendered user messages, assistant text, reasoning entries, and tool cards remain visible unless the JSONL-derived transcript itself changes them.

#### Scenario: Browser refresh restores the persisted prefix
- **WHEN** the user refreshes the browser while a Codex turn is running
- **THEN** the frontend reloads the selected Codex session from JSONL and renders all transcript content that has already been persisted.

### Requirement: Codex JSONL increment reading is cursor based

The system SHALL read Codex JSONL increments using a file-level cursor such as line number or byte offset. The cursor MUST NOT be derived from rendered frontend message count.

#### Scenario: Repeated file-change notification is idempotent
- **WHEN** the same Codex JSONL file-change notification is delivered more than once without new file content
- **THEN** the frontend renders no duplicate messages and keeps the same message order.

#### Scenario: Filtered JSONL rows do not move the cursor incorrectly
- **WHEN** the transcript contains non-rendered JSONL rows such as token counts, turn context, or metadata between rendered rows
- **THEN** the next increment request resumes after the last consumed JSONL row rather than after the number of rendered messages.

### Requirement: Codex tool calls merge by call identity

The system SHALL merge Codex `function_call`, `function_call_output`, `custom_tool_call`, and `custom_tool_call_output` entries by `call_id` into stable tool cards.

#### Scenario: Tool output completes the existing card
- **WHEN** JSONL first contains a tool call and later contains the matching tool output with the same `call_id`
- **THEN** the frontend updates the existing tool card in place instead of rendering a second card.

#### Scenario: Tool card remains stable across refresh
- **WHEN** a completed Codex tool call is visible and the user refreshes the browser
- **THEN** the refreshed JSONL replay renders exactly one completed tool card with the same command title, result summary, and relative message position.

### Requirement: Codex message ordering follows transcript order

The system SHALL preserve JSONL transcript order while applying deterministic merging for multi-row entities such as tool calls.

#### Scenario: Interleaved reasoning, tool call, and assistant text render in order
- **WHEN** a Codex transcript contains reasoning, a tool call, a matching tool result, and assistant text in one turn
- **THEN** the frontend renders those visible entities in the same logical order as the JSONL transcript.

#### Scenario: New increments append after existing persisted messages
- **WHEN** a running Codex session receives new JSONL rows after the frontend has already rendered earlier rows
- **THEN** the newly parsed visible messages append after the existing persisted prefix without clearing or reordering that prefix.

### Requirement: Codex WebSocket events only control status and refresh

The system SHALL use Codex WebSocket events for session status, abort availability, completion state, and JSONL refresh notifications. These events MUST NOT be the authoritative source of message content.

#### Scenario: Status changes do not overwrite message content
- **WHEN** the frontend receives `session-status` or equivalent processing-state events while JSONL messages are visible
- **THEN** the UI may update Thinking or Abort controls but MUST NOT remove or replace visible message content.

#### Scenario: Completion reloads final JSONL state
- **WHEN** a Codex turn completes
- **THEN** the frontend performs a final JSONL-based synchronization and renders the completed transcript without realtime-only placeholder messages.

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

# Manual provider runner contract

## Requirements

### Support Codex, OpenCode, and Pi manual sessions

Manual chat sessions use `codex`, `opencode`, and `pi` as the only supported providers.

- `POST /api/projects/:projectName/manual-sessions` accepts `codex` and creates a Codex draft session.
- `POST /api/projects/:projectName/manual-sessions` accepts `opencode` and creates an OpenCode draft session.
- `POST /api/projects/:projectName/manual-sessions` accepts `pi` and creates a Pi draft session.
- Missing or unsupported providers must not silently fall back to Claude.
- Provider selectors, model controls, thinking-mode controls, permission controls, and copy must not expose Claude as an available manual-session provider.
- WebSocket `claude-command` requests return an unsupported-provider error and must not call Claude SDK or Claude CLI code.

### Submit Codex, OpenCode, and Pi turns through the co file protocol

The web service does not directly own Codex/OpenCode/Pi CLI child processes for manual chat turns.

- The `co` executable is resolved from the current web service `PATH`; source code must not depend on a user-specific absolute `co` path.
- Runtime diagnostics expose the resolved `command_path` separately from `co`'s reported `home` directory.
- `co doctor --json` must return `ok: true` and `contract: co-request-v1` before manual-session drafts, message sends, or abort requests are accepted.
- The web service accepts both supported provider schemas from `co doctor --json`: `providers.<name>: true` and `providers.<name>.available: true`.
- Provider availability is checked with a fresh `co doctor --json` result immediately before request-file writes; stale startup diagnostics must not allow sends after a provider becomes unavailable.
- When a user sends a Codex manual-session message, the web service atomically writes a `co-request-v1` message request under `CCFLOW_CO_HOME/requests/pending/`.
- When a user sends an OpenCode manual-session message, the web service atomically writes a `co-request-v1` message request under `CCFLOW_CO_HOME/requests/pending/`.
- When a user sends a Pi manual-session message, the web service atomically writes a `co-request-v1` message request under `CCFLOW_CO_HOME/requests/pending/`.
- Requests include `request_id`, `op`, `conversation_id`, `project_path`, `provider`, `text`, `active_policy`, `target_turn_id`, `options`, `attachments`, and `actor` as applicable.
- `conversation_id` is the stable ccflow route identity and must not depend on a provider session id supplied by the browser.
- `co doctor --json` must report a compatible protocol and available target provider before chat sends are accepted.
- If co is unavailable or the target provider is unavailable, chat sends fail clearly and do not fall back to Node-owned provider execution.
- When provider gating fails, the browser shows an actionable error and the server does not create a manual-session draft, write a pending request, or send `message-accepted`.
- The web service tails co `events.jsonl` files and broadcasts existing frontend-consumed chat events; it must not hold Codex/OpenCode stdout or stderr pipes as the turn execution parent.

### co continuation conversation_id must resolve to stable cN route

When ccflow writes a co message request, `conversation_id` must be a stable `cN` route and must never use a raw provider session id from the browser.

#### Scenario: browser explicitly provides ccflowSessionId

- **Given** the browser sends a Codex, OpenCode, or Pi message with `ccflowSessionId = "c51"`
- **When** ccflow writes the co request
- **Then** the pending request `conversation_id` must be `"c51"`
- **And** it must not be overwritten by `sessionId` or provider session id

#### Scenario: browser only provides provider session id that maps through project config

- **Given** the project config maps a provider session id to `conversation_id = "c51"`
- **When** the browser sends a continuation message with only the provider session id
- **Then** ccflow must write `conversation_id = "c51"`
- **And** WebSocket relay events must carry `ccflowSessionId = "c51"`

#### Scenario: browser only provides provider session id that maps through co conversation state

- **Given** a co conversation state maps a provider session id to `conversation_id = "c51"`
- **When** the browser sends a continuation message with only the provider session id
- **Then** ccflow must write `conversation_id = "c51"`
- **And** WebSocket relay events must carry `ccflowSessionId = "c51"`

#### Scenario: provider session id cannot be resolved to any route

- **Given** the browser sends a continuation message with only a provider session id
- **And** the backend cannot find a matching `cN` from project config or co conversation state
- **When** ccflow processes the request
- **Then** the request must fail with a clear error
- **And** no request file must be written to `requests/pending/`

### Persist only minimal co state

Each running turn persists only the data needed to recover streaming state and coordinate with co.

- co owns `CCFLOW_CO_HOME/conversations/<conversationId>/state.json`.
- co owns `CCFLOW_CO_HOME/turns/<turnId>/state.json`.
- co owns `CCFLOW_CO_HOME/turns/<turnId>/events.jsonl`.
- No extra job, status, control, summary, or UI metadata files are created for the same turn.
- co request files exclude UI-only metadata and provider internal fields.
- `events.jsonl` uses the existing frontend-consumed event types, including `session-created`, provider response events, provider complete events, provider error events, token budget events, and `session-aborted`.

### Recover running turns after web service restart or browser refresh

Restarting the web service must not stop an already running Codex/OpenCode/Pi turn.

- On startup and browser status checks, the web service reads co conversation state by `conversation_id`.
- A conversation with `active_turn_id` is restored as an active session and the active turn's `events.jsonl` is tailed again.
- A browser `check-session-status` for an idle co conversation returns `session-status` with `isProcessing=false` and must not replay completed turn history as realtime provider response messages (`codex-response`, `opencode-response`, `pi-response`).
- Browser refreshes and reconnects use the stable `conversation_id` route identity, including after the route is finalized to a provider session id.
- Browser reconnects receive later co events for still-running turns.
- Terminal turns are removed from the active replay set so reconnecting clients do not receive duplicate completed response events.

### Keep cN route history and realtime events idempotent

Existing manual `cN` routes represent stable ccflow conversations, while `new-session-*` ids represent unsaved draft views.

- The browser treats `cN` route ids as stable conversation views, not as unsaved temporary sessions.
- Message filtering accepts realtime events addressed by either the `ccflowSessionId`/`conversation_id` route id or the mapped provider session id.
- Realtime assistant messages from co/Codex/OpenCode/Pi use stable identity fields such as conversation id, turn id, event sequence, message key, or client request id before appending to the transcript.
- When REST history has already loaded a message, replaying the same realtime `agent_message` event must update or ignore the existing row instead of appending a duplicate.
- Deduplication must not rely on message text alone, because different turns may legitimately produce identical assistant text.
- Sending multiple follow-up messages in the same `cN` page appends the current turn once and must not reinsert earlier user or assistant rows.

### Discover durable turns beyond active_turn_id

The observer must tail every turn whose events have been written, not only the currently active turn.

- When a conversation has no `active_turn_id` because co already completed the turn, the observer must still discover and tail that turn if it was not yet observed.
- The observer scans `state.turns` for unseen turn ids and attaches a tail for each new durable turn.
- Events from newly discovered durable turns are broadcast to the same `cN` route without replaying already-completed earlier turns.
- A fast-completed turn whose `active_turn_id` went from running to empty within a single poll interval must still be discovered via `state.turns` and broadcast.

### Forward follow-up responses with stable route identity

Every co event broadcast for a follow-up turn must carry the same `cN` route identity as the original conversation.

- Provider response events (`codex-response`, `opencode-response`, `pi-response`) for the second or later turn must include `ccflowSessionId` equal to the `conversation_id`.
- The payload must include `ccflow_session_id` equal to the `conversation_id`.
- `turnId` or `turn_id` must point to the correct follow-up turn id.
- Frontend session filtering must not drop the event because the mapped provider session id differs from the first turn.

### Keep check-session-status from suppressing later realtime events

Idle status checks may run while a queued or fast-completed turn is about to produce events.

- `check-session-status` for an idle conversation returns `session-status` with `isProcessing=false` and may clear loading UI.
- That response must not cause the frontend to ignore or discard subsequent provider response events (`codex-response`, `opencode-response`, `pi-response`) for a new turn.
- The frontend must remain able to append assistant messages from later turns after an idle status check.

### Coordinate running-turn intervention through co requests

Running-turn interventions target the co conversation and must be guarded by the current active turn id.

- Sending another message while a conversation is active writes a message request with an explicit `active_policy`, such as `queue` or `abort_and_send`.
- Aborting a running Codex, OpenCode, or Pi turn writes an `op = abort` co request with `conversation_id` and the UI-observed `target_turn_id`.
- When the browser only holds a provider session id, the abort request must use the same `conversation_id` resolution logic as message requests, resolving through project config or co conversation state.
- co must reject or ignore stale interventions whose `target_turn_id` does not match the current active turn.
- Successful aborts update co turn state and emit `session-aborted`.
- Abort handling does not depend on only the web service's in-memory AbortController state.

### Support multi-window and repeated browser actions through request ids

Multiple browser windows can operate on the same ccflow conversation.

- Two browser windows for the same conversation write requests with the same `conversation_id`.
- co serializes requests per conversation.
- `request_id` makes repeated browser submissions idempotent and prevents duplicate execution.
- Stale aborts from an old window must not interrupt a newer active turn.

### Cover provider removal and co recovery in tests

Tests cover the business behavior, not only component existence.

- Server tests cover the provider contract that only `codex`, `opencode`, and `pi` are accepted.
- Server tests cover co request fields and UI metadata exclusions.
- Server tests cover co doctor failure without runner fallback.
- Server tests cover boolean and object `co doctor` provider schemas.
- Server tests cover refresh recovery from co conversation state and active turn id propagation.
- Server tests cover idle `check-session-status` over the real WebSocket and assert completed co history is not replayed as realtime messages.
- Server tests cover ordered event persistence before completion and non-duplicated provider error events.
- Browser tests cover Codex/OpenCode/Pi co events still rendering after WebSocket reconnect.
- Browser tests cover REST history plus duplicate realtime replay events rendering one assistant row.
- Browser tests cover same-page `cN` follow-up sends rendering each user and assistant message once.
- Browser tests cover provider-unavailable gates before draft creation and immediately before request writes.
- Browser tests cover page reload while a co turn is running.
- Browser tests cover two windows sharing one conversation, duplicate request ids, and stale abort protection.
- Regression tests cover that Claude entry points are removed from project, chat, and settings surfaces.

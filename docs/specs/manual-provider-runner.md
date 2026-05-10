# Manual provider runner contract

## Requirements

### Support only Codex and OpenCode manual sessions

Manual chat sessions use `codex` and `opencode` as the only supported providers.

- `POST /api/projects/:projectName/manual-sessions` accepts `codex` and creates a Codex draft session.
- `POST /api/projects/:projectName/manual-sessions` accepts `opencode` and creates an OpenCode draft session.
- Missing or unsupported providers must not silently fall back to Claude.
- Provider selectors, model controls, thinking-mode controls, permission controls, and copy must not expose Claude as an available manual-session provider.
- WebSocket `claude-command` requests return an unsupported-provider error and must not call Claude SDK or Claude CLI code.

### Submit Codex and OpenCode turns through the co file protocol

The web service does not directly own Codex/OpenCode CLI child processes for manual chat turns.

- The `co` executable is resolved from the current web service `PATH`; source code must not depend on a user-specific absolute `co` path.
- Runtime diagnostics expose the resolved `command_path` separately from `co`'s reported `home` directory.
- `co doctor --json` must return `ok: true` and `contract: co-request-v1` before manual-session drafts, message sends, or abort requests are accepted.
- The web service accepts both supported provider schemas from `co doctor --json`: `providers.<name>: true` and `providers.<name>.available: true`.
- Provider availability is checked with a fresh `co doctor --json` result immediately before request-file writes; stale startup diagnostics must not allow sends after a provider becomes unavailable.
- When a user sends a Codex manual-session message, the web service atomically writes a `co-request-v1` message request under `CCFLOW_CO_HOME/requests/pending/`.
- When a user sends an OpenCode manual-session message, the web service atomically writes a `co-request-v1` message request under `CCFLOW_CO_HOME/requests/pending/`.
- Requests include `request_id`, `op`, `conversation_id`, `project_path`, `provider`, `text`, `active_policy`, `target_turn_id`, `options`, `attachments`, and `actor` as applicable.
- `conversation_id` is the stable ccflow route identity and must not depend on a provider session id supplied by the browser.
- `co doctor --json` must report a compatible protocol and available target provider before chat sends are accepted.
- If co is unavailable or the target provider is unavailable, chat sends fail clearly and do not fall back to Node-owned provider execution.
- When provider gating fails, the browser shows an actionable error and the server does not create a manual-session draft, write a pending request, or send `message-accepted`.
- The web service tails co `events.jsonl` files and broadcasts existing frontend-consumed chat events; it must not hold Codex/OpenCode stdout or stderr pipes as the turn execution parent.

### Persist only minimal co state

Each running turn persists only the data needed to recover streaming state and coordinate with co.

- co owns `CCFLOW_CO_HOME/conversations/<conversationId>/state.json`.
- co owns `CCFLOW_CO_HOME/turns/<turnId>/state.json`.
- co owns `CCFLOW_CO_HOME/turns/<turnId>/events.jsonl`.
- No extra job, status, control, summary, or UI metadata files are created for the same turn.
- co request files exclude UI-only metadata and provider internal fields.
- `events.jsonl` uses the existing frontend-consumed event types, including `session-created`, provider response events, provider complete events, provider error events, token budget events, and `session-aborted`.

### Recover running turns after web service restart or browser refresh

Restarting the web service must not stop an already running Codex/OpenCode turn.

- On startup and browser status checks, the web service reads co conversation state by `conversation_id`.
- A conversation with `active_turn_id` is restored as an active session and the active turn's `events.jsonl` is tailed again.
- Browser refreshes and reconnects use the stable `conversation_id` route identity, including after the route is finalized to a provider session id.
- Browser reconnects receive later co events for still-running turns.
- Terminal turns are removed from the active replay set so reconnecting clients do not receive duplicate completed response events.

### Coordinate running-turn intervention through co requests

Running-turn interventions target the co conversation and must be guarded by the current active turn id.

- Sending another message while a conversation is active writes a message request with an explicit `active_policy`, such as `queue` or `abort_and_send`.
- Aborting a running Codex or OpenCode turn writes an `op = abort` co request with `conversation_id` and the UI-observed `target_turn_id`.
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

- Server tests cover the provider contract that only `codex` and `opencode` are accepted.
- Server tests cover co request fields and UI metadata exclusions.
- Server tests cover co doctor failure without runner fallback.
- Server tests cover boolean and object `co doctor` provider schemas.
- Server tests cover refresh recovery from co conversation state and active turn id propagation.
- Server tests cover ordered event persistence before completion and non-duplicated provider error events.
- Browser tests cover Codex/OpenCode co events still rendering after WebSocket reconnect.
- Browser tests cover provider-unavailable gates before draft creation and immediately before request writes.
- Browser tests cover page reload while a co turn is running.
- Browser tests cover two windows sharing one conversation, duplicate request ids, and stale abort protection.
- Regression tests cover that Claude entry points are removed from project, chat, and settings surfaces.

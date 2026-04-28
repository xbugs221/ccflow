## Why

The current project list is anchored to Claude project history, so Codex-only projects are invisible until manually added or touched by Claude. This blocks Codex-first workflows and makes new Codex sessions undiscoverable in the web UI.

## What Changes

- Add Codex-driven project discovery so projects with Codex session history appear even when no Claude project exists.
- Merge discovered Codex-only projects into the same `/api/projects` response used by the web app.
- Preserve existing Claude/Cursor/Gemini behavior and deduplicate projects by normalized absolute path.
- Populate discovered Codex-only projects with display metadata and recent Codex sessions for immediate web visibility.

## Capabilities

### New Capabilities
- `codex-project-discovery`: Discover project entries directly from Codex session history and surface them in the unified project list.

### Modified Capabilities
- None.

## Impact

- Server project aggregation logic in `server/projects.js`.
- Project list behavior for `/api/projects` consumers in the web UI.
- Codex session indexing reuse to derive project-level entries.

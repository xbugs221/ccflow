## Implementation Notes

### Summary

Implemented Codex-only project discovery in `server/projects.js#getProjects` by:
- tracking known normalized project paths from Claude/manual discovery,
- reusing a per-request Codex sessions index,
- synthesizing project entries for unknown Codex paths,
- preserving frontend-compatible project shape defaults.

### Codex-only Project Output Shape

Each synthesized project includes:
- `name`
- `path`
- `displayName`
- `fullPath`
- `isCustomName`
- `sessions` (empty array)
- `cursorSessions` (empty array)
- `codexSessions` (discovered sessions)
- `geminiSessions` (empty array)
- `sessionMeta` (`{ hasMore: false, total: 0 }`)

### Verification Performed

- Syntax validation:
  - `node --check server/projects.js`
- Discovery validation:
  - Executed `getProjects()` and confirmed Codex-only projects are present when Codex history exists.
- Deduplication validation:
  - Executed `getProjects()` and verified no duplicate normalized project paths are returned.

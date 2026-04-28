## 1. Codex Discovery Data Flow

- [x] 1.1 Update `getProjects()` to collect normalized known project paths while processing Claude and manually-added projects.
- [x] 1.2 Reuse the per-request Codex sessions index to enumerate project paths that are not already known.
- [x] 1.3 For each unknown Codex path, create a synthetic project object with deterministic path-derived `name` and display metadata.

## 2. Merge Behavior and Compatibility

- [x] 2.1 Ensure Codex-only projects include frontend-compatible defaults (`sessions`, `cursorSessions`, `geminiSessions`, `sessionMeta`) plus discovered `codexSessions`.
- [x] 2.2 Add deduplication and collision handling so normalized path overlap does not create duplicate project rows.
- [x] 2.3 Keep existing Claude/Cursor/Gemini project aggregation behavior unchanged for already-known projects.

## 3. Verification

- [x] 3.1 Validate `/api/projects` includes Codex-only projects when only `~/.codex/sessions` data exists.
- [x] 3.2 Validate no duplicate project is returned when Claude/manual and Codex entries share the same normalized path.
- [x] 3.3 Document/confirm expected output shape for Codex-only project entries in this change's implementation notes or tests.

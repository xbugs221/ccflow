## Context

`getProjects()` in `server/projects.js` currently seeds the project list from `~/.claude/projects` and manually-added config entries. Codex sessions are only attached to those known projects by calling `getCodexSessions(actualProjectDir)`, which means Codex-only projects are never materialized as project rows. The Codex index builder already parses all `~/.codex/sessions/**/*.jsonl` and groups sessions by normalized `cwd`, so the missing piece is converting those index keys into project objects when no Claude/manual entry exists.

## Goals / Non-Goals

**Goals:**
- Include Codex-only projects in `/api/projects` output without requiring prior Claude activity.
- Reuse existing Codex index data to avoid duplicate scanning work.
- Keep project objects consistent with current frontend expectations (`name`, `path`, `displayName`, session collections, `sessionMeta`).
- Avoid duplicate projects when the same path is already represented by Claude/manual discovery.

**Non-Goals:**
- Changing Claude, Cursor, or Gemini session parsing formats.
- Introducing persistent storage for discovered Codex-only projects.
- Redesigning frontend project grouping or sorting behavior beyond supplying complete backend data.

## Decisions

1. Build Codex session index once per `getProjects()` call and reuse it for both existing projects and Codex-only discovery.
- Rationale: avoids repeated filesystem traversal under `~/.codex/sessions` and keeps per-request cost bounded.
- Alternative considered: call `getCodexSessions()` independently for each project and then run a second discovery pass. Rejected due to duplicate scans and harder consistency guarantees.

2. Create synthetic project entries for Codex index paths not present in known project path set.
- Rationale: this directly addresses the gap while keeping Claude/manual projects authoritative when overlap exists.
- Alternative considered: auto-write these projects into `~/.claude/project-config.json`. Rejected because discovery should remain read-only and avoid side effects.

3. Generate Codex-only project `name` deterministically from absolute path using existing manual-project encoding (`replace(/[\\/:\s~_]/g, '-')`).
- Rationale: aligns naming conventions already used in this codebase and avoids introducing new identifier formats.
- Alternative considered: use Codex session IDs or hashed identifiers. Rejected because path-derived names are more debuggable and compatible with existing APIs.

4. Populate synthetic project fields with safe defaults and discovered Codex sessions.
- Rationale: frontend already handles optional/missing session arrays; setting explicit defaults prevents rendering regressions.
- Alternative considered: return a reduced project shape for Codex-only entries. Rejected due to increased branching in frontend consumers.

## Risks / Trade-offs

- [Risk] Path normalization mismatch between discovered known projects and Codex index keys could cause duplicate entries. → Mitigation: use the same `normalizeComparablePath()` helper for both sets before deduplication.
- [Risk] Codex history directory with many files could slow project loading. → Mitigation: keep single index build per request and preserve current per-project Codex session limit in response payloads.
- [Risk] Path-derived names may collide for unusual paths after character replacement. → Mitigation: if collision occurs, prefer existing project entry and append a stable suffix for synthetic duplicates only when needed.

## Migration Plan

1. Extend `getProjects()` to track known normalized paths while processing Claude/manual entries.
2. Reuse/derive Codex sessions index map and add Codex-only project objects for unknown paths.
3. Ensure each synthetic project includes default arrays/meta fields expected by API consumers.
4. Validate `/api/projects` now includes Codex-only projects and does not duplicate existing ones.
5. If regression is observed, rollback by gating Codex-only synthesis behind a feature flag default-off (temporary rollback path).

## Open Questions

- Should Codex-only projects be visually marked in the UI (e.g., `isCodexOnly`) or remain transparent to users?
- Do we want deterministic secondary sorting for synthetic projects (recent activity vs. display name) in backend or frontend?

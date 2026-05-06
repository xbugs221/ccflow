## ADDED Requirements

### Requirement: Discover Codex-only projects
The system SHALL include a project in the unified project list when Codex session history exists for a project path, even if no Claude project directory or manual project configuration exists for that path.

#### Scenario: Codex-only path appears as project
- **WHEN** a normalized project path exists in Codex session history and is absent from Claude/manual discovered projects
- **THEN** `/api/projects` includes a project entry for that path with its Codex sessions

### Requirement: Prevent duplicate project entries across providers
The system SHALL deduplicate projects by normalized absolute project path when merging Claude/manual discovered projects with Codex-discovered projects.

#### Scenario: Existing Claude project suppresses Codex duplicate
- **WHEN** a Claude project resolves to the same normalized path as a Codex-discovered project path
- **THEN** `/api/projects` returns a single project entry for that path and does not add a second Codex-only entry

### Requirement: Provide frontend-compatible defaults for Codex-only projects
For Codex-only discovered projects, the system SHALL return the standard project object shape used by the web UI, including default values for non-Codex session collections and session metadata.

#### Scenario: Codex-only project renders without missing fields
- **WHEN** a Codex-only project is returned by `/api/projects`
- **THEN** the project object includes `name`, `path`, `displayName`, `fullPath`, `sessions`, `cursorSessions`, `codexSessions`, `geminiSessions`, and `sessionMeta`

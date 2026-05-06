## ADDED Requirements

### Requirement: Validate project path existence during project-list refresh
The system SHALL validate whether each discovered project path exists when handling a project-list refresh request.

#### Scenario: Missing project path is detected during refresh
- **WHEN** the backend handles `GET /api/projects` and a discovered project's absolute path does not exist on disk
- **THEN** the system marks that project path as archived with reason `path-missing` and an archive timestamp

### Requirement: Hide archived missing-path projects from active sidebar data
The system SHALL exclude projects archived for missing paths from active project results returned to the WebUI.

#### Scenario: Archived project is not returned by projects API
- **WHEN** a project path is archived due to missing path detection
- **THEN** subsequent `GET /api/projects` responses do not include that project in the returned project list

### Requirement: Preserve historical session data when archiving missing-path projects
The system SHALL archive missing-path projects without deleting associated historical sessions.

#### Scenario: Archiving does not remove historical records
- **WHEN** a project is archived because its path no longer exists
- **THEN** Claude/Cursor/Codex historical session files remain untouched and are not physically deleted by the archive action

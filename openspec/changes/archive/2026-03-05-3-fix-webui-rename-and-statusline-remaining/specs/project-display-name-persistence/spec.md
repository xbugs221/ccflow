## ADDED Requirements

### Requirement: Persist custom project display names by normalized path
The system SHALL persist and resolve custom project display names using normalized absolute project paths so that naming behavior is consistent across Claude, manual, and Codex-only projects.

#### Scenario: Codex-only project rename survives refresh
- **WHEN** a user renames a Codex-only project and the rename request includes its project path
- **THEN** subsequent `GET /api/projects` responses return the renamed `displayName` for that same normalized path

### Requirement: Maintain backward compatibility for legacy name-based config
The system SHALL continue to honor existing legacy display-name entries keyed by `projectName` when no path-based custom name exists.

#### Scenario: Legacy custom name still works after upgrade
- **WHEN** a project has a legacy `projectName`-keyed custom name and no path-keyed override
- **THEN** the project list uses that legacy custom name instead of auto-generated naming

### Requirement: Path-based custom name takes precedence over legacy key
The system SHALL prioritize path-keyed custom names over legacy project-name keys when both are present.

#### Scenario: Path override wins on key conflict
- **WHEN** both path-keyed and projectName-keyed custom names exist for the same project
- **THEN** the project list displays the path-keyed custom name

### Requirement: Clearing custom names restores automatic naming
The system SHALL remove custom naming overrides when an empty display name is submitted.

#### Scenario: Empty rename resets to auto display name
- **WHEN** a rename request submits an empty or whitespace-only display name
- **THEN** the project falls back to auto-generated display naming on the next project refresh

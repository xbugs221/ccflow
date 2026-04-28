# provider-usage-remaining-indicator Specification

## Purpose
TBD - created by archiving change fix-webui-rename-and-statusline-remaining. Update Purpose after archive.
## Requirements
### Requirement: Expose provider-specific 5h/7d remaining metrics
The system SHALL provide a normalized provider-scoped payload containing `fiveHourRemaining` and `sevenDayRemaining` values for UI consumption.

#### Scenario: Remaining metrics are returned for active provider
- **WHEN** the frontend requests usage-remaining data for a specific provider
- **THEN** the backend response includes that provider's 5-hour and 7-day remaining values in a consistent schema

### Requirement: Chat controls display 5hours/7days remaining instead of token pie
The chat input control SHALL render `5hours/7days remaining` data in place of the token percentage pie component.

#### Scenario: Claude session shows remaining limits near mode button
- **WHEN** the active chat provider is Claude and remaining metrics are available
- **THEN** the mode-button area shows Claude 5h/7d remaining values and does not render the token pie percentage

#### Scenario: Codex session shows remaining limits near mode button
- **WHEN** the active chat provider is Codex and remaining metrics are available
- **THEN** the mode-button area shows Codex 5h/7d remaining values and does not render the token pie percentage

### Requirement: Provider adapters remain isolated
The system SHALL keep Claude and Codex remaining-metric collection paths independent so one provider's source or failure cannot corrupt the other's output.

#### Scenario: Provider switch rebinds remaining source
- **WHEN** the user switches from Claude to Codex (or vice versa)
- **THEN** the displayed remaining values are refreshed from the newly active provider adapter

### Requirement: Degrade gracefully when remaining data is unavailable
The system SHALL render a non-blocking fallback state when remaining metrics cannot be fetched or parsed.

#### Scenario: Remaining source unavailable
- **WHEN** the provider adapter returns no valid 5h/7d data
- **THEN** the UI shows a placeholder remaining state and chat sending behavior remains unchanged


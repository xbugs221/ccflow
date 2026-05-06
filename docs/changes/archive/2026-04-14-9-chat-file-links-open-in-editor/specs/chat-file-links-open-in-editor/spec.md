## ADDED Requirements

### Requirement: Assistant workspace file references resolve against the selected project
The system SHALL recognize workspace file references inside assistant markdown replies and resolve them to files under the selected project instead of treating them as ordinary browser URLs.

#### Scenario: Opening an absolute workspace file reference
- **WHEN** an authenticated user clicks an assistant markdown link whose href is an absolute file path under the selected project root
- **THEN** the system SHALL open that file in the embedded editor for the current project

#### Scenario: Opening a project-relative workspace file reference
- **WHEN** an authenticated user clicks an assistant markdown link whose href is a relative workspace path
- **THEN** the system SHALL resolve that path against the selected project root and open the matching file in the embedded editor

#### Scenario: Opening a file reference that includes a line suffix
- **WHEN** an authenticated user clicks an assistant markdown link whose href targets a workspace file and also includes a line anchor or line suffix
- **THEN** the system SHALL still open the referenced file in the embedded editor instead of navigating the browser to a broken URL

### Requirement: Workspace file references stay in the current chat workspace
The system SHALL route recognized workspace file references through the in-app editor flow so the user does not lose the active chat session context.

#### Scenario: Clicking a workspace file reference from an assistant reply
- **WHEN** an authenticated user clicks a recognized workspace file reference in an assistant markdown message
- **THEN** the current chat route SHALL remain active and the editor sidebar SHALL display the referenced file

### Requirement: Non-workspace links retain normal browser behavior
The system SHALL continue to treat non-workspace links as normal hyperlinks so chat content can still reference external resources.

#### Scenario: Opening an external documentation link
- **WHEN** an authenticated user clicks an assistant markdown link whose href is not a workspace file reference
- **THEN** the system SHALL leave the embedded editor unchanged and SHALL open the link using normal browser navigation behavior

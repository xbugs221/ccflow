## MODIFIED Requirements

### Requirement: The editor classifies files before choosing a render mode
The system SHALL determine whether an opened file is text, markdown, image, or binary before rendering the editor workflow.

#### Scenario: Opening a text file
- **WHEN** an authenticated user opens a text file from the project workspace
- **THEN** the system SHALL show the editable code editor surface with save controls

#### Scenario: Opening a binary file
- **WHEN** an authenticated user opens a binary file from the project workspace
- **THEN** the system SHALL show a dedicated non-editable binary placeholder instead of the text editor surface

#### Scenario: Opening a UTF-8 markdown file whose sample boundary splits a multibyte character
- **WHEN** an authenticated user opens a valid UTF-8 Markdown file and the server-side text sample ends in the middle of a multibyte character
- **THEN** the system SHALL still classify the file as editable Markdown content instead of binary

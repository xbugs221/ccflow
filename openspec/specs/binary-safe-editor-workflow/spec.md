## Purpose

Define how the workspace editor handles text, markdown, image, and binary files without corrupting non-text content.

## Requirements

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

### Requirement: Binary files remain non-editable in the editor workflow
The system SHALL prevent binary files from exposing text-only editing controls while still guiding the user toward safe actions.

#### Scenario: Showing binary-only affordances
- **WHEN** an authenticated user opens a binary file in the editor workflow
- **THEN** the system SHALL hide save and markdown-preview controls and SHALL present a download action

#### Scenario: Opening a file containing null bytes
- **WHEN** an authenticated user opens a workspace file whose content contains null bytes
- **THEN** the system SHALL treat that file as non-editable binary content

### Requirement: Binary downloads preserve exact bytes
The system SHALL return binary file downloads without altering the stored bytes.

#### Scenario: Downloading a binary file from the editor
- **WHEN** an authenticated user downloads a binary file from the editor workflow
- **THEN** the downloaded file SHALL match the exact bytes stored in the selected project workspace

### Requirement: Image files continue to use a visual preview path
The system SHALL keep image assets on a visual-preview path rather than treating them as editable text or opaque binary placeholders.

#### Scenario: Opening an image asset from the file tree
- **WHEN** an authenticated user opens an image file from the project workspace
- **THEN** the system SHALL display a visual image preview instead of the text editor surface

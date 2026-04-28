## ADDED Requirements

### Requirement: Users can manage workspace entries from the file tree
The system SHALL let an authenticated user create, rename, and delete files or directories inside the selected project directly from the file tree without requiring terminal access.

#### Scenario: Creating a file from the file tree
- **WHEN** an authenticated user opens the file tree for a project and creates a new file at the project root
- **THEN** the file SHALL be created inside that project, appear in the file tree after refresh, and be available to open in the editor

#### Scenario: Renaming a directory from the file tree
- **WHEN** an authenticated user renames an existing directory from the file tree
- **THEN** the original path SHALL disappear, the new path SHALL appear, and nested contents SHALL move with the renamed directory

#### Scenario: Deleting a file from the file tree
- **WHEN** an authenticated user confirms deletion of an existing file from the file tree
- **THEN** the file SHALL be removed from the project workspace and no longer appear in the refreshed tree

### Requirement: Users can upload workspace content into a selected directory
The system SHALL accept file and folder uploads into a chosen project directory while preserving relative paths for nested content.

#### Scenario: Uploading a nested folder into the project root
- **WHEN** an authenticated user uploads a folder that contains nested files into the project root
- **THEN** the resulting workspace SHALL preserve the uploaded folder name and nested relative paths

#### Scenario: Rejecting paths outside the selected project
- **WHEN** an authenticated user submits an upload payload whose relative paths would resolve outside the selected project root
- **THEN** the system SHALL reject the request and SHALL NOT write files outside the selected project workspace

### Requirement: Users can download workspace content from the file tree
The system SHALL let an authenticated user download individual files and whole folders from the file tree without altering file bytes.

#### Scenario: Downloading a single file from the tree
- **WHEN** an authenticated user downloads a file from the file tree
- **THEN** the downloaded file SHALL match the bytes currently stored in the selected project workspace

#### Scenario: Downloading a folder as an archive
- **WHEN** an authenticated user downloads a directory from the file tree
- **THEN** the system SHALL return an archive that preserves the selected directory name, nested paths, and file contents

### Requirement: File tree actions are available from scoped UI affordances
The system SHALL expose file-tree actions through both toolbar actions and context-sensitive menus so users can discover operations without memorizing shortcuts.

#### Scenario: Opening a directory context menu
- **WHEN** an authenticated user opens the context menu for a directory row in the file tree
- **THEN** the menu SHALL include actions for creating children, renaming, deleting, copying the path, and downloading that directory

#### Scenario: Opening the file tree background menu
- **WHEN** an authenticated user opens the context menu on empty space in the file tree
- **THEN** the menu SHALL include root-scoped actions for creating a new file, creating a new folder, and refreshing the tree

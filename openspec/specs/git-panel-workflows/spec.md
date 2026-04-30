## Purpose

定义 Git 面板中的本地/远程分支展示、分支生命周期管理、暂存区状态区分和操作失败反馈工作流，确保用户能在面板内完成常见 Git 操作。

## Requirements

### Requirement: The Git panel presents local and remote branch workflows explicitly
The system SHALL expose a dedicated Git panel view that separates local and remote branches for the selected project.

#### Scenario: Viewing local and remote sections
- **WHEN** an authenticated user opens the branches workflow for a Git-backed project that has both local and remote branches
- **THEN** the panel SHALL render separate local and remote branch sections and SHALL identify the current local branch

### Requirement: Users can manage branch lifecycle from the Git panel
The system SHALL let an authenticated user create, switch, and delete branches from the Git panel with safeguards for the active branch.

#### Scenario: Creating and switching to a new branch
- **WHEN** an authenticated user creates a new branch from the Git panel
- **THEN** the branch SHALL appear in the local branch section and the panel SHALL be able to switch to it

#### Scenario: Rejecting deletion of the current branch
- **WHEN** an authenticated user attempts to delete the currently checked out branch from the Git panel
- **THEN** the system SHALL block the deletion and SHALL show the user that the current branch cannot be removed

#### Scenario: Deleting a non-current branch
- **WHEN** an authenticated user deletes a non-current local branch from the Git panel
- **THEN** that branch SHALL be removed from the local branch section after refresh

### Requirement: The Git panel distinguishes staged and unstaged work
The system SHALL present staged and unstaged changes separately so users can understand commit scope before submitting.

#### Scenario: Viewing staged and unstaged sections
- **WHEN** an authenticated user opens the changes workflow for a repository that contains both staged and unstaged modifications
- **THEN** the panel SHALL render separate staged and unstaged sections and SHALL show the total changed-file count in the changes view

### Requirement: Git operation failures are visible and dismissible in the panel
The system SHALL surface Git operation failures inline within the Git panel instead of relying only on console output.

#### Scenario: Fetch failure shows an inline error banner
- **WHEN** an authenticated user triggers a fetch operation that fails
- **THEN** the Git panel SHALL show an inline error banner that identifies the failed operation and allows the user to dismiss the message

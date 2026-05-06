## Why

The current Git panel covers status and commits but still pushes branch-heavy workflows back to the terminal. Users cannot complete common repository operations such as managing local versus remote branches, deleting stale branches safely, or understanding failed fetch/pull/push actions from the panel itself.

## What Changes

- Add a dedicated branches workflow to the Git panel, including local and remote branch sections.
- Add branch creation, switching, and deletion flows with guardrails for the current branch.
- Improve change review by separating staged and unstaged work and surfacing change counts in the panel.
- Add inline operation error banners so failed Git actions are visible and recoverable from the UI.
- Harden Git route execution so repository operations use argument-safe process spawning instead of shell-interpolated commands.

## Capabilities

### New Capabilities
- `git-panel-workflows`: Complete common branch and change-management workflows from the Git panel with safe backend execution and clear UI feedback.

### Modified Capabilities
- None.

## Impact

- Affected frontend areas: `src/components/git-panel/**`.
- Affected backend areas: `server/routes/git.js` and related API typing/utilities.
- Security-sensitive paths are involved because Git command construction will change.
- Acceptance coverage will need realistic repository workflows including branch lifecycle and failure handling.
